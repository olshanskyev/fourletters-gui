import { Injectable, inject } from '@angular/core';
import { lastValueFrom } from 'rxjs';

import { GroupKeySet, WrappedGroupKey } from '@dto/models';
import { CryptoService } from '@core/services/crypto';
import { AuthService } from '@core/services/authentication/auth.service';
import { ContactsService } from '@core/services/contacts';
import { IdentityService } from '@core/services/identity';
import { GroupsApiService } from './groups-api.service';
import { GroupsRepository } from './groups.repository';

/**
 * Owns the device-local lifecycle of symmetric group keys: minting a fresh epoch key and sealing
 * it to a roster, unsealing wrapped blobs the caller receives, persisting keys per epoch, and
 * recovering a missing key from the Server on demand.
 */
@Injectable({
  providedIn: 'root'
})
export class GroupKeyService {
  private crypto = inject(CryptoService);
  private auth = inject(AuthService);
  private contacts = inject(ContactsService);
  private identity = inject(IdentityService);
  private api = inject(GroupsApiService);
  private groupsRepo = inject(GroupsRepository);

  /** The unwrapped group key for an epoch, or undefined if this device has not stored it yet. */
  async getKey(groupId: string, epoch: number): Promise<CryptoKey | undefined> {
    const record = await this.groupsRepo.getGroupKey(groupId, epoch);
    return record?.key;
  }

  /** Persist an unwrapped group key for an epoch. */
  async storeKey(groupId: string, epoch: number, key: CryptoKey): Promise<void> {
    await this.groupsRepo.putGroupKey(groupId, epoch, key);
  }

  /**
   * The group key for an epoch, fetched and unsealed from the Server if not already local (the
   * offline-recovery path).
   */
  async ensureKey(groupId: string, epoch: number): Promise<CryptoKey> {
    const local = await this.getKey(groupId, epoch);
    if (local) {
      return local;
    }
    const keySet = await lastValueFrom(this.api.getGroupKey(groupId, epoch));
    return this.unwrapAndStore(keySet);
  }

  /**
   * The current epoch and its group key, for sending. Resolving both together guarantees the
   * epoch stamped on the wire matches the key the message was encrypted under.
   */
  async ensureCurrentKey(groupId: string): Promise<{ key: CryptoKey; epoch: number }> {
    const group = await this.groupsRepo.getGroup(groupId);
    if (!group) {
      throw new Error(`Local group metadata missing: ${groupId}`);
    }
    const key = await this.ensureKey(groupId, group.epoch);
    return { key, epoch: group.epoch };
  }

  /** Unseal a wrapped key the caller received (inbox drain or recovery) and store it. */
  async unwrapAndStore(keySet: GroupKeySet): Promise<CryptoKey> {
    const myEncryptionPrivateKey = await this.identity.getEncryptionPrivateKey();
    const key = await this.crypto.unwrapGroupKey(keySet.wrappedKey, myEncryptionPrivateKey);
    await this.storeKey(keySet.groupId, keySet.epoch, key);
    return key;
  }

  /**
   * Mint a fresh epoch key and seal it to every member of {@code roster} (which must include the
   * caller). Returns the live key plus the per-member wrapped blobs to post to the Server. The
   * caller persists the key once it knows the assigned groupId/epoch.
   */
  async mintKeysFor(roster: string[]): Promise<{ key: CryptoKey; keys: WrappedGroupKey[] }> {
    const key = await this.crypto.generateGroupKey();
    const myId = this.auth.currentUser()?.id;

    const keys: WrappedGroupKey[] = [];
    for (const memberId of roster) {
      const publicKey = await this.encryptionKeyOf(memberId, myId);
      const wrappedKey = await this.crypto.wrapGroupKeyFor(key, publicKey);
      keys.push({ recipientId: memberId, wrappedKey });
    }
    return { key, keys };
  }

  /** Resolve a member's ECDH encryption public key — from the local identity for self, else the directory. */
  private async encryptionKeyOf(memberId: string, myId: string | undefined): Promise<CryptoKey> {
    if (memberId === myId) {
      return this.identity.getEncryptionPublicKey();
    }
    const contact = await this.contacts.getContactKeys(memberId);
    return contact.encryptionPublicKey;
  }
}
