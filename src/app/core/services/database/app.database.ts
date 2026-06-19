import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { LocalMessage } from '../messages/models/messages.model';
import { LocalConversation } from '../conversations/models/conversations.model';

export type MetaRecords = 'serverStartedAt' | 'dbMasterKey';
export interface MetaRecord {
  id: MetaRecords;
  value: any;
}

export type IdentityRecords = 'identityKeyPair' | 'encryptionKeyPair';
export interface IdentityRecord {
  id: IdentityRecords;
  value: CryptoKeyPair;
}

export interface ContactRecord {
  id: string; // userId
  signingPublicKey: CryptoKey;
  encryptionPublicKey: CryptoKey;
}

export class UserDatabase extends Dexie {
  messages!: Table<LocalMessage, string>;
  conversations!: Table<LocalConversation, string>;
  identity!: Table<IdentityRecord, string>;
  contacts!: Table<ContactRecord, string>;
  meta!: Table<MetaRecord, string>;

  constructor(userId: string) {
    super(`fourletters:${userId}`);

    this.version(1).stores({
      messages: 'id, conversationId, createdAt, status',
      conversations: 'id, updatedAt',
      identity: 'id',
      contacts: 'id',
      meta: 'id'
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

  get db(): UserDatabase {
    if (!this._db) {
      throw new Error('Database not initialized. Call initialize(userId) first.');
    }
    return this._db;
  }

  get messages() { return this.db.messages; }
  get conversations() { return this.db.conversations; }
  get identity() { return this.db.identity; }
  get contacts() { return this.db.contacts; }
  get meta() { return this.db.meta; }

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
