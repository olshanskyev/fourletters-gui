// Persistence for the group Sender-Key cipher
// Two record kinds live here: this device's own Sender Key per group epoch (groupSenderKeys) and
// the Sender Keys learned from peers via their Sender Key Distribution Messages (groupPeerKeys).

import { Injectable, inject } from '@angular/core';
import { AppDatabase, GroupPeerKeyRecord, GroupSenderKeyRecord } from '@core/services/database/app.database';

@Injectable({ providedIn: 'root' })
export class GroupKeyStore {
  private readonly appDb = inject(AppDatabase);

  private senderId(groupId: string, epoch: number): string {
    return `${groupId}:${epoch}`;
  }

  private peerId(groupId: string, epoch: number, senderId: string): string {
    return `${groupId}:${epoch}:${senderId}`;
  }

  // --- This device's own Sender Key ----------------------------------------------------
  getSenderKey(groupId: string, epoch: number): Promise<GroupSenderKeyRecord | undefined> {
    return this.appDb.groupSenderKeys.get(this.senderId(groupId, epoch));
  }

  async putSenderKey(record: GroupSenderKeyRecord): Promise<void> {
    await this.appDb.groupSenderKeys.put(record);
  }

  // --- Peers' Sender Keys --------------------------------------------------------------
  getPeerKey(groupId: string, epoch: number, senderId: string)
    : Promise<GroupPeerKeyRecord | undefined> {
    return this.appDb.groupPeerKeys.get(this.peerId(groupId, epoch, senderId));
  }

  async putPeerKey(record: GroupPeerKeyRecord): Promise<void> {
    await this.appDb.groupPeerKeys.put(record);
  }

  /**
   * Drop every Sender Key (own and peers') for this group whose epoch is below the current one.
   * Called after a membership removal bumps the epoch, so a removed member's chain keys are erased
   * (backward secrecy) and cannot be reused.
   */
  async pruneOldEpochs(groupId: string, currentEpoch: number): Promise<void> {
    const staleSender = await this.appDb.groupSenderKeys
      .where('groupId').equals(groupId)
      .filter(r => r.epoch < currentEpoch)
      .primaryKeys();
    const stalePeer = await this.appDb.groupPeerKeys
      .where('groupId').equals(groupId)
      .filter(r => r.epoch < currentEpoch)
      .primaryKeys();
    await this.appDb.groupSenderKeys.bulkDelete(staleSender);
    await this.appDb.groupPeerKeys.bulkDelete(stalePeer);
  }

  /** Drop all group key material for a group (used when leaving/removing a group locally). */
  async deleteGroup(groupId: string): Promise<void> {
    const senderKeys = await this.appDb.groupSenderKeys.where('groupId').equals(groupId).primaryKeys();
    const peerKeys = await this.appDb.groupPeerKeys.where('groupId').equals(groupId).primaryKeys();
    await this.appDb.groupSenderKeys.bulkDelete(senderKeys);
    await this.appDb.groupPeerKeys.bulkDelete(peerKeys);
  }

  /** Wipe all group key material (session revocation / new-device reset). */
  async wipe(): Promise<void> {
    await this.appDb.groupSenderKeys.clear();
    await this.appDb.groupPeerKeys.clear();
  }
}
