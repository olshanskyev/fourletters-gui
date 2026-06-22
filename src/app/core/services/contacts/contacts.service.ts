import { Injectable, inject } from '@angular/core';
import { lastValueFrom } from 'rxjs';

import { CryptoService } from '@core/services/crypto';
import { ContactRecord } from '@core/services/database/app.database';
import { KeysApiService } from '@core/services/identity/keys-api.service';
import { ContactsRepository } from './contacts.repository';

/**
 * Resolves and caches other users' public keys from the directory.
 */
@Injectable({
  providedIn: 'root'
})
export class ContactsService {
  private crypto = inject(CryptoService);
  private contactsRepo = inject(ContactsRepository);
  private keysApi = inject(KeysApiService);

  /**
   * Fetches (from directory or local cache) and returns a user's public keys.
   */
  async getContactKeys(userId: string): Promise<ContactRecord> {
    let contact = await this.contactsRepo.getContact(userId);
    if (!contact) {
      const remoteKeys = await lastValueFrom(this.keysApi.getUserKeys(userId));
      const signingPublicKey = await this.crypto.importIdentityPublicKey(
        remoteKeys.keys.signingPublicKey
      );
      const encryptionPublicKey = await this.crypto.importEncryptionPublicKey(
        remoteKeys.keys.encryptionPublicKey
      );

      contact = { id: userId, signingPublicKey, encryptionPublicKey };
      await this.contactsRepo.putContact(contact);
    }
    return contact;
  }
}
