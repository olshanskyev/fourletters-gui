import { Injectable, inject } from '@angular/core';
import { lastValueFrom } from 'rxjs';

import {
  CreateGroupRequest,
  Group,
  UpdateMembersRequest
} from '@dto/models';
import { GroupRecord } from '@core/services/database/app.database';
import { GroupsApiService } from './groups-api.service';
import { GroupsRepository } from './groups.repository';
import { staleWhileRevalidate } from '@core/services/cache/swr-cache';

/**
 * High-level group management: creating groups, owner-only roster changes, and leaving. The Server
 * owns only the roster; a group message is sent by the client as one independent 1:1 copy per
 * member, so there is no group key to mint, wrap, distribute, or rotate.
 */
@Injectable({
  providedIn: 'root'
})
export class GroupsService {
  private api = inject(GroupsApiService);
  private groupsRepo = inject(GroupsRepository);

  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Retrieves a group. Uses Stale-While-Revalidate caching strategy.
   * Returns immediately if cached, but fetches in background if stale.
   */
  getGroup(groupId: string, forceRefresh = false): Promise<GroupRecord | undefined> {
    return staleWhileRevalidate({
      readCache: () => this.groupsRepo.getGroup(groupId),
      revalidate: () => this.fetchAndCacheGroup(groupId),
      ttlMs: this.CACHE_TTL_MS,
      forceRefresh,
      onBackgroundError: err => console.error('Background group refresh failed', err)
    });
  }

  /** Create a group with the caller as owner. */
  async createGroup(name: string, memberIds: string[]): Promise<Group> {
    const request: CreateGroupRequest = { name, members: memberIds };
    const group = await lastValueFrom(this.api.createGroup(request));

    await this.persistGroup(group);
    return group;
  }

  /** Reconcile the caller's group list from the Server, refreshing local rosters. */
  async syncGroups(): Promise<void> {
    const summaries = await lastValueFrom(this.api.listGroups());
    for (const summary of summaries) {
      await this.refreshGroup(summary.id);
    }
  }

  /** Fetch a group's full detail from the Server and persist it locally. */
  async refreshGroup(groupId: string): Promise<Group> {
    const group = await lastValueFrom(this.api.getGroup(groupId));
    await this.persistGroup(group);
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

  /** Leave a group and drop its local conversation and metadata. */
  async leaveGroup(groupId: string): Promise<void> {
    await lastValueFrom(this.api.leaveGroup(groupId));
    await this.removeLocalGroup(groupId);
  }

  /**
   * The current roster for a group, always refreshed from the Server. The Server is the only
   * authority on membership
   */
  async getMembers(groupId: string): Promise<string[]> {
    const group = await this.refreshGroup(groupId);
    return group.members.map(m => m.userId);
  }

  /** Whether a user is in a group's locally known roster (used to authorize group receipts). */
  async isMember(groupId: string, userId: string): Promise<boolean> {
    const group = await this.groupsRepo.getGroup(groupId);
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

  private async fetchAndCacheGroup(groupId: string): Promise<GroupRecord> {
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
      updatedAt: group.updatedAt ?? Date.now()
    };
  }

  private async removeLocalGroup(groupId: string): Promise<void> {
    await this.groupsRepo.deleteGroup(groupId);
  }
}
