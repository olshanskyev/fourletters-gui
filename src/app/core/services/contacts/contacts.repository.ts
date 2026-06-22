import { Injectable, inject } from '@angular/core';
import { AppDatabase, ContactRecord } from '@core/services/database/app.database';

/**
 * Encapsulates device-local persistence for the contacts directory cache
 */
@Injectable({
  providedIn: 'root'
})
export class ContactsRepository {

  private readonly db = inject(AppDatabase);

  /** A cached contact, or undefined if not yet resolved on this device. */
  async getContact(userId: string): Promise<ContactRecord | undefined> {
    return this.db.contacts.get(userId);
  }

  /** Add or update a cached contact. */
  async putContact(contact: ContactRecord): Promise<void> {
    await this.db.contacts.put(contact);
  }
}
