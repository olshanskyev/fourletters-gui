import { Injectable, inject } from '@angular/core';
import { AppDatabase, GroupRecord } from '@core/services/database/app.database';

/**
 * Encapsulates device-local persistence for the groups domain: group roster metadata.
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
}
