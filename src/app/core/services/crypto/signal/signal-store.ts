// Signal protocol store backed by the per-user Dexie database. Implements the library's StorageType
// so SessionBuilder/SessionCipher can persist our identity, (signed) pre-keys, sessions, and the
// trusted identity keys of contacts. Identities are auto-trusted (TOFU); a *changed* remote identity
// is surfaced via identityChanged$ so ContactsService can re-pin and raise the "key changed" warning.
// Note: store methods are intentionally lock-free — callers wrap whole operations in withSignalLock.
import { Injectable, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { Direction, KeyPairType, SessionRecordType, StorageType } from '@privacyresearch/libsignal-protocol-typescript';
import { AppDatabase } from '@core/services/database/app.database';
import { Base64 } from '../../helpers';

const IDENTITY_KEY = 'identityKeyPair';
const REG_ID_KEY = 'registrationId';

@Injectable({ providedIn: 'root' })
export class SignalProtocolStore implements StorageType {
  private readonly appDb = inject(AppDatabase);

  private readonly identityChangedSubject = new Subject<{ userId: string; identityKey: string }>();
  /** Emits the contact whose Curve25519 identity just changed, carrying its new Base64 key so listeners re-pin without a directory fetch. */
  readonly identityChanged$: Observable<{ userId: string; identityKey: string }> = this.identityChangedSubject.asObservable();

  // --- Our identity --------------------------------------------------------------------
  async getIdentityKeyPair(): Promise<KeyPairType | undefined> {
    const rec = await this.appDb.signalIdentity.get(IDENTITY_KEY);
    return rec?.value as KeyPairType | undefined;
  }

  async getLocalRegistrationId(): Promise<number | undefined> {
    const rec = await this.appDb.signalIdentity.get(REG_ID_KEY);
    return rec?.value as number | undefined;
  }

  // --- Contact identities (trust-on-first-use, auto-accept changes) ---------------------
  async isTrustedIdentity(_identifier: string, _identityKey: ArrayBuffer, _direction: Direction): Promise<boolean> {
    return true; // auto-accept; the visible "key changed" warning is raised by ContactsService
  }

  async saveIdentity(encodedAddress: string, publicKey: ArrayBuffer): Promise<boolean> {
    const userId = addressName(encodedAddress);
    const existing = await this.appDb.signalRemoteIdentities.get(userId);
    const changed = existing != null && !buffersEqual(existing.identityKey, publicKey);
    await this.appDb.signalRemoteIdentities.put({ id: userId, identityKey: publicKey });
    if (changed) {
      this.identityChangedSubject.next({ userId, identityKey: Base64.bufferToBase64(publicKey) });
    }
    return changed;
  }

  // --- One-time pre-keys ---------------------------------------------------------------
  async loadPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
    return toKeyPair(await this.appDb.signalPreKeys.get(String(keyId)));
  }

  async storePreKey(keyId: string | number, keyPair: KeyPairType): Promise<void> {
    await this.appDb.signalPreKeys.put({ id: String(keyId), pubKey: keyPair.pubKey, privKey: keyPair.privKey });
  }

  async removePreKey(keyId: string | number): Promise<void> {
    await this.appDb.signalPreKeys.delete(String(keyId));
  }

  // --- Signed pre-keys -----------------------------------------------------------------
  async loadSignedPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
    return toKeyPair(await this.appDb.signalSignedPreKeys.get(String(keyId)));
  }

  async storeSignedPreKey(keyId: string | number, keyPair: KeyPairType): Promise<void> {
    await this.appDb.signalSignedPreKeys.put({ id: String(keyId), pubKey: keyPair.pubKey, privKey: keyPair.privKey });
  }

  async removeSignedPreKey(keyId: string | number): Promise<void> {
    await this.appDb.signalSignedPreKeys.delete(String(keyId));
  }

  // --- Sessions ------------------------------------------------------------------------
  async loadSession(encodedAddress: string): Promise<SessionRecordType | undefined> {
    return (await this.appDb.signalSessions.get(encodedAddress))?.record;
  }

  async storeSession(encodedAddress: string, record: SessionRecordType): Promise<void> {
    await this.appDb.signalSessions.put({ id: encodedAddress, record });
  }

  // --- Local helpers used by SignalSessionService --------------------------------------
  /** True once this device has generated and stored its own identity key pair. */
  async hasIdentity(): Promise<boolean> {
    return (await this.appDb.signalIdentity.get(IDENTITY_KEY)) != null;
  }

  async putIdentityKeyPair(keyPair: KeyPairType): Promise<void> {
    await this.appDb.signalIdentity.put({ id: IDENTITY_KEY, value: keyPair });
  }

  async putRegistrationId(registrationId: number): Promise<void> {
    await this.appDb.signalIdentity.put({ id: REG_ID_KEY, value: registrationId });
  }

  /** Returns and advances the next free one-time pre-key id (persisted so ids never collide). */
  async takePreKeyIds(count: number): Promise<number[]> {
    const rec = await this.appDb.signalIdentity.get('nextPreKeyId');
    const start = (rec?.value as number | undefined) ?? 1;
    const ids = Array.from({ length: count }, (_, i) => start + i);
    await this.appDb.signalIdentity.put({ id: 'nextPreKeyId', value: start + count });
    return ids;
  }

  /** Drop every Signal record on this device (session revocation / new-device reset). */
  async wipe(): Promise<void> {
    await Promise.all([
      this.appDb.signalIdentity.clear(),
      this.appDb.signalPreKeys.clear(),
      this.appDb.signalSignedPreKeys.clear(),
      this.appDb.signalSessions.clear(),
      this.appDb.signalRemoteIdentities.clear()
    ]);
  }
}

/** The contact userId carried in an encoded address `name.deviceId` (userIds are UUIDs, no dots). */
function addressName(encodedAddress: string): string {
  const dot = encodedAddress.lastIndexOf('.');
  return dot === -1 ? encodedAddress : encodedAddress.slice(0, dot);
}

function toKeyPair(rec: { pubKey: ArrayBuffer; privKey: ArrayBuffer } | undefined): KeyPairType | undefined {
  return rec ? { pubKey: rec.pubKey, privKey: rec.privKey } : undefined;
}

function buffersEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a), y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
