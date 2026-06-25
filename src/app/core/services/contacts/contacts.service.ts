import { Injectable, inject } from '@angular/core';
import { Observable, Subject, lastValueFrom } from 'rxjs';

import { CryptoService } from '@core/services/crypto';
import { SignalSessionService } from '@core/services/crypto/signal';
import { ContactRecord } from '@core/services/database/app.database';
import { KeysApiService } from '@core/services/identity/keys-api.service';
import { PublicKeySet } from '@dto/models';
import { ContactsRepository } from './contacts.repository';

@Injectable({
  providedIn: 'root'
})
export class ContactsService {
  private crypto = inject(CryptoService);
  private contactsRepo = inject(ContactsRepository);
  private keysApi = inject(KeysApiService);
  private signal = inject(SignalSessionService);

  private readonly keyChangedSubject = new Subject<{ userId: string }>();
  /**
   * Emits when a contact's directory identity key changes from the previously pinned one — a
   * legitimate rotation after a new-device login, or a server key substitution.
   */
  readonly keyChanged$: Observable<{ userId: string }> = this.keyChangedSubject.asObservable();

  constructor() {
    this.signal.identitySeen$.subscribe(({ userId, identityKey }) => {
      this.pinIdentityKey(userId, identityKey).catch(err => console.error('Failed to pin identity key', userId, err));
    });
  }

  /** The cached contact record (identity key + registration id), pinned on first contact. */
  async getContactRecord(userId: string): Promise<ContactRecord> {
    const cached = await this.contactsRepo.getContact(userId);
    return cached ?? (await this.fetchAndPin(userId)).record;
  }

  /** A peer's Base64 Curve25519 identity key, used to verify their receipt signatures. */
  async getIdentityKey(userId: string): Promise<string> {
    return (await this.getContactRecord(userId)).identityKey;
  }

  /** Always fetch a fresh pre-key bundle (consumes a one-time pre-key) to open/re-open a session. */
  async getContactBundle(userId: string): Promise<PublicKeySet> {
    return (await this.fetchAndPin(userId)).bundle;
  }

  /** Force a directory re-fetch and reconcile the pin, returning the updated record. */
  async refreshContactKey(userId: string): Promise<ContactRecord> {
    return (await this.fetchAndPin(userId)).record;
  }

  /** Fetch the directory bundle and (re)pin the contact's identity from it, returning record + bundle. */
  private async fetchAndPin(userId: string)
    : Promise<{ record: ContactRecord; bundle: PublicKeySet }> {
    const bundle = (await lastValueFrom(this.keysApi.getUserKeys(userId))).keys;
    const record = await this.pinIdentityKey(userId, bundle.identityKey, bundle.registrationId);
    return { record, bundle };
  }

  /**
   * Pin a contact's Curve25519 identity (key + fingerprint). Announces a real change via keyChanged$
   * only when it differs from a previously pinned one. Pure local write — works from a key in hand.
   */
  private async pinIdentityKey(userId: string, identityKey: string, registrationId?: number)
    : Promise<ContactRecord> {
    const freshFingerprint = await this.crypto.fingerprintIdentityKey(identityKey);

    const prev = await this.contactsRepo.getContact(userId);
    const changed = prev?.keyFingerprint != null && prev.keyFingerprint !== freshFingerprint;

    const record: ContactRecord = {
      id: userId,
      identityKey,
      registrationId: registrationId ?? prev?.registrationId ?? 0,
      keyFingerprint: freshFingerprint,
      pinnedAt: Date.now()
    };
    await this.contactsRepo.putContact(record);

    if (changed) {
      this.keyChangedSubject.next({ userId });
    }
    return record;
  }
}
