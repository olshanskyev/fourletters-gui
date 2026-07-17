import { Injectable, inject } from '@angular/core';
import { lastValueFrom, Observable } from 'rxjs';

import {
  CreateGroupRequest,
  Group,
  GroupSummary,
  UpdateGroupRequest,
  UpdateMembersRequest
} from '@dto/models';
import { GroupRecord } from '@core/services/database/app.database';
import { GroupsApiService } from './groups-api.service';
import { GroupsRepository } from './groups.repository';
import { staleWhileRevalidate } from '@core/services/cache/swr-cache';
import { GroupKeyStore } from '@core/services/crypto/group';
import { InFlightRequests } from '../helpers';

@Injectable({
  providedIn: 'root'
})
export class GroupsService {
  private api = inject(GroupsApiService);
  private groupsRepo = inject(GroupsRepository);
  private groupKeys = inject(GroupKeyStore);

  /** In-flight group fetches, keyed by groupId, to collapse concurrent requests into one. */
  private readonly inFlightFetches = new InFlightRequests<string>();

  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Retrieves a group, cache-first (SWR): returns the cached record immediately and only hits the
   * server when the cache is missing or stale.
   */
  getGroup(groupId: string): Promise<GroupRecord | undefined> {
    return staleWhileRevalidate({
      readCache: () => this.groupsRepo.getGroup(groupId),
      revalidate: () => this.fetchGroup(groupId),
      ttlMs: this.CACHE_TTL_MS,
      onBackgroundError: err => console.error('Background group refresh failed', err)
    });
  }

  /**
   * Fetch-and-observe a group: forces a server refresh, then streams the local record. The cached
   * value emits immediately and the refresh's cache write re-emits with the fresh data.
   */
  fetchAndObserveGroup(groupId: string): Observable<GroupRecord | undefined> {
    this.fetchGroup(groupId).catch(err =>
      console.error('Background group refresh failed', err)
    );
    return this.groupsRepo.observeGroup(groupId);
  }

  /** Create a group with the caller as owner. */
  async createGroup(name: string, memberIds: string[], avatarUrl?: string): Promise<Group> {
    const request: CreateGroupRequest = { name, members: memberIds, avatarUrl };
    const group = await lastValueFrom(this.api.createGroup(request));

    await this.persistGroup(group);
    return group;
  }

  /** Reconcile the caller's group list from the Server. One request; rosters load lazily on demand. */
  async syncGroups(): Promise<void> {
    const summaries = await lastValueFrom(this.api.listGroups());
    for (const summary of summaries) {
      await this.persistSummary(summary);
    }
  }

  /** Fetch a group's full detail from the Server and persist it locally. */
  async refreshGroup(groupId: string): Promise<Group> {
    const previous = await this.groupsRepo.getGroup(groupId);
    const group = await lastValueFrom(this.api.getGroup(groupId));
    await this.persistGroup(group);
    // A Server epoch bump (a member was removed) invalidates every Sender Key for the old epoch.
    const epoch = group.epoch ?? 0;
    if (previous && (previous.epoch ?? 0) < epoch) {
      await this.groupKeys.pruneOldEpochs(groupId, epoch);
    }
    return group;
  }

  /** Owner-only: add members. */
  async addMembers(groupId: string, addIds: string[]): Promise<Group> {
    return this.updateRoster(groupId, addIds, []);
  }

  /** Owner-only: remove members. */
  async removeMembers(groupId: string, removeIds: string[]): Promise<Group> {
    return this.updateRoster(groupId, [], removeIds);
  }

  /** Owner-only: partially update group metadata (name and/or avatar). */
  async updateGroup(groupId: string, changes: UpdateGroupRequest): Promise<Group> {
    const group = await lastValueFrom(this.api.updateGroup(groupId, changes));

    await this.persistGroup(group);
    return group;
  }

  /** Owner-only: rename the group. */
  updateName(groupId: string, name: string): Promise<Group> {
    return this.updateGroup(groupId, { name });
  }

  /** Owner-only: set the group avatar (pass an empty string to clear it). */
  updateAvatar(groupId: string, avatarUrl: string): Promise<Group> {
    return this.updateGroup(groupId, { avatarUrl });
  }

  /** Leave a group and drop its local conversation and metadata. */
  async leaveGroup(groupId: string): Promise<void> {
    await lastValueFrom(this.api.leaveGroup(groupId));
    await this.removeLocalGroup(groupId);
  }

  /**
   * The current roster together with the Server-authoritative Sender-Key epoch, always refreshed
   * from the Server.
   */
  async getRoster(groupId: string): Promise<{ members: string[]; epoch: number }> {
    const group = await this.refreshGroup(groupId);
    return { members: group.members.map(m => m.userId), epoch: group.epoch ?? 0 };
  }

  /**
   * Whether a user is in a group's roster (used to authorize group receipts).
   */
  async isMember(groupId: string, userId: string): Promise<boolean> {
    const group = await this.getGroup(groupId);
    return group?.members.includes(userId) ?? false;
  }

  // ---- Local persistence -----------------------------------------------------------------

  private async updateRoster(groupId: string, add: string[], remove: string[]): Promise<Group> {
    const request: UpdateMembersRequest = { add, remove };
    const group = await lastValueFrom(this.api.updateMembers(groupId, request));

    await this.persistGroup(group);
    return group;
  }

  private async persistGroup(group: Group): Promise<void> {
    await this.groupsRepo.putGroup(this.toRecord(group));
  }

  /**
   * Cache a group's summary (name, owner) without fetching its roster.
   */
  private async persistSummary(summary: GroupSummary): Promise<void> {
    const existing = await this.groupsRepo.getGroup(summary.id);
    await this.groupsRepo.putGroup({
      id: summary.id,
      name: summary.name,
      ownerId: summary.ownerId,
      members: existing?.members ?? [],
      avatarUrl: existing?.avatarUrl,
      epoch: summary.epoch ?? existing?.epoch ?? 0,
      updatedAt: existing?.updatedAt ?? Date.now()
    });
  }

  private fetchGroup(groupId: string): Promise<GroupRecord> {
    // De-duplicate concurrent fetches: several subscribers (e.g. the conversations list and the
    // chat header) can request the same stale group at once; collapse them into one server call.
    return this.inFlightFetches.run(groupId, () => this.doFetchGroup(groupId));
  }

  private async doFetchGroup(groupId: string): Promise<GroupRecord> {
    const group = await lastValueFrom(this.api.getGroup(groupId));
    const record = this.toRecord(group);
    await this.groupsRepo.putGroup(record);
    return record;
  }

  private toRecord(group: Group): GroupRecord {
    return {
      id: group.id,
      name: group.name,
      ownerId: group.ownerId,
      members: group.members.map(m => m.userId),
      avatarUrl: group.avatarUrl,
      epoch: group.epoch ?? 0,
      updatedAt: Date.now()
    };
  }

  private async removeLocalGroup(groupId: string): Promise<void> {
    await this.groupsRepo.deleteGroup(groupId);
    await this.groupKeys.deleteGroup(groupId);
  }
}
