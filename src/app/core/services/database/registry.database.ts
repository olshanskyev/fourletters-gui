import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';

export interface UserRegistryEntry {
  userId: string;
  name?: string;
  avatarUrl?: string;
}

export class RegistryDatabaseInstance extends Dexie {
  users!: Table<UserRegistryEntry, string>;

  constructor() {
    super('fourletters:registry');
    this.version(1).stores({
      users: 'userId'
    });
  }
}

@Injectable({
  providedIn: 'root'
})
export class RegistryDatabase {
  private db: RegistryDatabaseInstance;

  constructor() {
    this.db = new RegistryDatabaseInstance();
  }

  get users() { return this.db.users; }
}
