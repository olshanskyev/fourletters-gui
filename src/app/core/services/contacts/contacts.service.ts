import { Injectable, inject } from '@angular/core';
import { Observable, Subject, lastValueFrom } from 'rxjs';

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

  private readonly keyChangedSubject = new Subject<{ userId: string }>();
  /**
   * Emits when a contact's directory key changes from the previously pinned one — a legitimate
   * rotation after a new-device login, or a server key substitution.
   */
  readonly keyChanged$: Observable<{ userId: string }> = this.keyChangedSubject.asObservable();

  /**
   * A user's public keys — from the local cache, or on first contact from the directory, pinned
   * trust-on-first-use. Use {@link refreshContactKey} to force a directory reconcile.
   */
  async getContactKeys(userId: string): Promise<ContactRecord> {
    const cached = await this.contactsRepo.getContact(userId);
    if (cached) {
      return cached;
    }
    return this.fetchAndPin(userId);
  }

  /**
   * Force a directory re-fetch and reconcile the pin. If the fetched key differs from the pinned
   * fingerprint it is re-pinned
   */
  async refreshContactKey(userId: string): Promise<ContactRecord> {
    return this.fetchAndPin(userId);
  }

  /** Fetch the directory key, compute its fingerprint, and (re)pin it, announcing a real change. */
  private async fetchAndPin(userId: string): Promise<ContactRecord> {
    const remoteKeys = await lastValueFrom(this.keysApi.getUserKeys(userId));
    const signingB64 = remoteKeys.keys.signingPublicKey;
    const encryptionB64 = remoteKeys.keys.encryptionPublicKey;
    const freshFingerprint = await this.crypto.fingerprintPublicKeys(signingB64, encryptionB64);

    const previous = await this.contactsRepo.getContact(userId);
    const changed = previous?.keyFingerprint != null && previous.keyFingerprint !== freshFingerprint;

    const signingPublicKey = await this.crypto.importIdentityPublicKey(signingB64);
    const encryptionPublicKey = await this.crypto.importEncryptionPublicKey(encryptionB64);

    const contact: ContactRecord = {
      id: userId,
      signingPublicKey,
      encryptionPublicKey,
      keyFingerprint: freshFingerprint,
      pinnedAt: Date.now()
    };
    await this.contactsRepo.putContact(contact);

    if (changed) {
      this.keyChangedSubject.next({ userId });
    }
    return contact;
  }
}
