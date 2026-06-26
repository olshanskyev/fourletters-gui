import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { LocalMessage } from '@core/services/messages';
import { LocalConversation } from '@core/services/conversations';

export type MetaRecords = 'serverStartedAt' | 'dbMasterKey';
export interface MetaRecord {
  id: MetaRecords;
  value: any;
}

export interface ContactRecord {
  id: string; // userId
  identityKey: string; // contact's Curve25519 identity public key (Base64) — the pinned identity
  registrationId: number; // contact's Signal registration id
  keyFingerprint?: string; // SHA-256 of the identity key — used to detect rotations
  pinnedAt?: number; // epoch ms when keyFingerprint was last pinned
}

export interface UserProfileRecord {
  id: string; // userId
  username?: string;
  avatarUrl?: string;
  localName?: string; // fallback customizable local name
  updatedAt: number; // epoch ms
}

// --- Signal protocol store records (keys are ArrayBuffers, sessions are serialized strings) ---
export interface SignalIdentityRecord { id: 'identityKeyPair' | 'registrationId' | 'nextPreKeyId'; value: any; }
export interface SignalKeyPairRecord { id: string; pubKey: ArrayBuffer; privKey: ArrayBuffer; }
export interface SignalSessionRecord { id: string; record: string; }
export interface SignalRemoteIdentityRecord { id: string; identityKey: ArrayBuffer; }

/** Locally cached group metadata: roster and owner. */
export interface GroupRecord {
  id: string; // server-assigned groupId
  name: string;
  ownerId: string;
  members: string[]; // roster user ids
  updatedAt: number; // epoch ms
}

export class UserDatabase extends Dexie {
  messages!: Table<LocalMessage, string>;
  conversations!: Table<LocalConversation, string>;
  contacts!: Table<ContactRecord, string>;
  meta!: Table<MetaRecord, string>;
  groups!: Table<GroupRecord, string>;
  profiles!: Table<UserProfileRecord, string>;
  signalIdentity!: Table<SignalIdentityRecord, string>;
  signalPreKeys!: Table<SignalKeyPairRecord, string>;
  signalSignedPreKeys!: Table<SignalKeyPairRecord, string>;
  signalSessions!: Table<SignalSessionRecord, string>;
  signalRemoteIdentities!: Table<SignalRemoteIdentityRecord, string>;

  constructor(userId: string) {
    super(`fourletters:${userId}`);

    this.version(1).stores({
      messages: 'id, conversationId, createdAt, status',
      conversations: 'id, updatedAt',
      contacts: 'id',
      meta: 'id',
      groups: 'id, ownerId',
      profiles: 'id, updatedAt',
      signalIdentity: 'id',
      signalPreKeys: 'id',
      signalSignedPreKeys: 'id',
      signalSessions: 'id',
      signalRemoteIdentities: 'id'
    });
  }
}

@Injectable({
  providedIn: 'root'
})
export class AppDatabase {
  private _db: UserDatabase | null = null;
  private _userId: string | null = null;

  get isInitialized(): boolean {
    return this._db !== null;
  }

  /** The owner's user id this database belongs to (used to scope the cross-tab Signal lock). */
  get userId(): string {
    if (!this._userId) {
      throw new Error('Database not initialized. Call initialize(userId) first.');
    }
    return this._userId;
  }

  get db(): UserDatabase {
    if (!this._db) {
      throw new Error('Database not initialized. Call initialize(userId) first.');
    }
    return this._db;
  }

  get messages() { return this.db.messages; }
  get conversations() { return this.db.conversations; }
  get contacts() { return this.db.contacts; }
  get meta() { return this.db.meta; }
  get groups() { return this.db.groups; }
  get profiles() { return this.db.profiles; }
  get signalIdentity() { return this.db.signalIdentity; }
  get signalPreKeys() { return this.db.signalPreKeys; }
  get signalSignedPreKeys() { return this.db.signalSignedPreKeys; }
  get signalSessions() { return this.db.signalSessions; }
  get signalRemoteIdentities() { return this.db.signalRemoteIdentities; }

  initialize(userId: string) {
    if (this._userId === userId && this._db) {
      return;
    }
    if (this._db) {
      this._db.close();
    }
    this._userId = userId;
    this._db = new UserDatabase(userId);
  }

  close() {
    if (this._db) {
      this._db.close();
      this._db = null;
      this._userId = null;
    }
  }

  async getMeta<T>(key: MetaRecords): Promise<T | undefined> {
    const record = await this.meta.get(key);
    return record?.value;
  }

  async setMeta<T>(key: MetaRecords, value: T): Promise<void> {
    await this.meta.put({ id: key, value });
  }

  async deleteMeta(key: MetaRecords): Promise<void> {
    await this.meta.delete(key);
  }
}
