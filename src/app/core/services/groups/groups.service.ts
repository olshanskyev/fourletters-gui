import { Injectable, inject } from '@angular/core';
import { lastValueFrom } from 'rxjs';

import {
  CreateGroupRequest,
  Group,
  GroupKeyDistribution,
  GroupKeyNotification,
  GroupKeySet,
  UpdateMembersRequest
} from '@dto/models';
import { GroupRecord } from '@core/services/database/app.database';
import { AuthService } from '@core/services/authentication/auth.service';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { GroupsApiService } from './groups-api.service';
import { GroupKeyService } from './group-key.service';
import { GroupsRepository } from './groups.repository';

/**
 * High-level group management: creating groups, owner-only roster changes, any-member key
 * rotation, leaving, and reacting to rotation nudges / inbox key catch-up. Each mint operation
 * generates a fresh epoch key, seals it to the resulting roster, posts it, and persists the
 * locally usable key for the new epoch.
 */
@Injectable({
  providedIn: 'root'
})
export class GroupsService {
  private api = inject(GroupsApiService);
  private groupKeys = inject(GroupKeyService);
  private conversations = inject(ConversationsService);
  private groupsRepo = inject(GroupsRepository);
  private auth = inject(AuthService);

  private myId(): string {
    const id = this.auth.currentUser()?.id;
    if (!id) {
      throw new Error('Cannot manage groups while unauthenticated.');
    }
    return id;
  }

  /** Create a group at epoch 0 with the caller as owner. */
  async createGroup(name: string, memberIds: string[]): Promise<Group> {
    const roster = Array.from(new Set([...memberIds, this.myId()]));
    const { key, keys } = await this.groupKeys.mintKeysFor(roster);

    const request: CreateGroupRequest = { name, members: memberIds, keys };
    const group = await lastValueFrom(this.api.createGroup(request));

    await this.groupKeys.storeKey(group.id, group.epoch, key);
    await this.persistGroup(group);
    return group;
  }

  /** Reconcile the caller's group list from the Server, refreshing local rosters and epochs. */
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

  /** Owner-only: add members and rotate to the next epoch. */
  async addMembers(groupId: string, addIds: string[]): Promise<Group> {
    return this.updateRoster(groupId, addIds, []);
  }

  /** Owner-only: remove members and rotate to the next epoch. */
  async removeMembers(groupId: string, removeIds: string[]): Promise<Group> {
    return this.updateRoster(groupId, [], removeIds);
  }

  /**
   * Any-member key rotation with no roster change — used to restore forward secrecy after a
   * member leaves. Refreshes the roster first so the new key covers exactly the current members.
   */
  async rotateKey(groupId: string): Promise<Group> {
    const current = await this.refreshGroup(groupId);
    const roster = current.members.map(m => m.userId);
    const { key, keys } = await this.groupKeys.mintKeysFor(roster);

    const request: GroupKeyDistribution = { epoch: current.epoch + 1, keys };
    const group = await lastValueFrom(this.api.rotateGroupKey(groupId, request));

    await this.groupKeys.storeKey(groupId, group.epoch, key);
    await this.persistGroup(group);
    return group;
  }

  /** Leave a group and drop its local conversation, metadata, and keys. */
  async leaveGroup(groupId: string): Promise<void> {
    await lastValueFrom(this.api.leaveGroup(groupId));
    await this.removeLocalGroup(groupId);
  }

  /**
   * React to a {@code groupKeyRotated} nudge: pull and unseal the new epoch's wrapped key and
   * refresh the local roster/epoch. The key itself never travels over the nudge channel.
   */
  async onGroupKeyRotated(notification: GroupKeyNotification): Promise<void> {
    await this.groupKeys.ensureKey(notification.groupId, notification.epoch);
    await this.refreshGroup(notification.groupId);
  }

  /** Unseal and store any wrapped keys carried on the inbox drain (offline catch-up). */
  async handleIncomingGroupKeys(keySets: GroupKeySet[]): Promise<void> {
    for (const keySet of keySets) {
      await this.groupKeys.unwrapAndStore(keySet);
    }
  }

  /** Whether a user is in a group's locally known roster (used to authorize group receipts). */
  async isMember(groupId: string, userId: string): Promise<boolean> {
    const group = await this.groupsRepo.getGroup(groupId);
    return group?.members.includes(userId) ?? false;
  }

  // ---- Local persistence -----------------------------------------------------------------

  private async updateRoster(groupId: string, add: string[], remove: string[]): Promise<Group> {
    const current = await this.requireLocalGroup(groupId);

    const roster = new Set(current.members);
    add.forEach(id => roster.add(id));
    remove.forEach(id => roster.delete(id));
    roster.add(current.ownerId); // the owner can never be removed

    const { key, keys } = await this.groupKeys.mintKeysFor([...roster]);
    const request: UpdateMembersRequest = { add, remove, epoch: current.epoch + 1, keys };
    const group = await lastValueFrom(this.api.updateMembers(groupId, request));

    await this.groupKeys.storeKey(groupId, group.epoch, key);
    await this.persistGroup(group);
    return group;
  }

  private async persistGroup(group: Group): Promise<void> {
    await this.groupsRepo.putGroup({
      id: group.id,
      name: group.name,
      ownerId: group.ownerId,
      epoch: group.epoch,
      members: group.members.map(m => m.userId),
      updatedAt: group.updatedAt ?? Date.now()
    });

    const existing = await this.conversations.getGroupConversation(group.id);
    if (!existing) {
      await this.conversations.createConversation(
        group.name,
        'group',
        group.members.map(m => m.userId),
        group.id
      );
    }
  }

  private async requireLocalGroup(groupId: string): Promise<GroupRecord> {
    let record = await this.groupsRepo.getGroup(groupId);
    if (!record) {
      await this.refreshGroup(groupId);
      record = await this.groupsRepo.getGroup(groupId);
    }
    if (!record) {
      throw new Error(`Group not found: ${groupId}`);
    }
    return record;
  }

  private async removeLocalGroup(groupId: string): Promise<void> {
    await this.groupsRepo.deleteGroup(groupId);
    await this.groupsRepo.deleteGroupKeysForGroup(groupId);
  }
}
