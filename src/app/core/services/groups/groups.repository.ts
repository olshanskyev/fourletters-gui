import { Injectable, inject } from '@angular/core';
import { AppDatabase, GroupRecord, GroupKeyRecord } from '@core/services/database/app.database';

/**
 * Encapsulates device-local persistence for the groups domain: group metadata and the per-epoch
 * symmetric group keys. The `${groupId}:${epoch}` composite key format is an internal detail.
 */
@Injectable({
  providedIn: 'root'
})
export class GroupsRepository {

  private readonly db = inject(AppDatabase);

  // --- Group metadata -------------------------------------------------------------------

  /** Locally cached group metadata, or undefined if this device has not stored it. */
  async getGroup(groupId: string): Promise<GroupRecord | undefined> {
    return this.db.groups.get(groupId);
  }

  /** Add or update a group's local metadata. */
  async putGroup(record: GroupRecord): Promise<void> {
    await this.db.groups.put(record);
  }

  /** Drop a group's local metadata. */
  async deleteGroup(groupId: string): Promise<void> {
    await this.db.groups.delete(groupId);
  }

  // --- Group keys (per epoch) -----------------------------------------------------------

  /** The stored key record for an epoch, or undefined if this device has not stored it. */
  async getGroupKey(groupId: string, epoch: number): Promise<GroupKeyRecord | undefined> {
    return this.db.groupKeys.get(GroupsRepository.keyId(groupId, epoch));
  }

  /** Persist an unwrapped group key for an epoch. */
  async putGroupKey(groupId: string, epoch: number, key: CryptoKey): Promise<void> {
    await this.db.groupKeys.put({ id: GroupsRepository.keyId(groupId, epoch), groupId, epoch, key });
  }

  /** Drop every stored key for a group (e.g. after leaving). */
  async deleteGroupKeysForGroup(groupId: string): Promise<void> {
    await this.db.groupKeys.where('groupId').equals(groupId).delete();
  }

  private static keyId(groupId: string, epoch: number): string {
    return `${groupId}:${epoch}`;
  }
}
