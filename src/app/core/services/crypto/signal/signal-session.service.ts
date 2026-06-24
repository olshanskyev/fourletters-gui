// Owns all Double Ratchet crypto for 1:1 messaging via @privacyresearch/libsignal-protocol-typescript.
// Single place that: generates our identity + (signed/one-time) pre-keys and the upload bundle,
// establishes sessions from a peer's bundle, and encrypts/decrypts ratchet messages. Also signs and
// verifies receipts with the Curve25519 identity key (receipts travel via the Server, not the ratchet).
// Every high-level operation runs under withSignalLock so concurrent tabs can't corrupt ratchet state.
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import SignalProtocol, {
  Curve,
  KeyHelper,
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress
} from '@privacyresearch/libsignal-protocol-typescript';
import { KeysUploadRequest, OneTimePreKeyDto, PublicKeySet } from '@dto/models';
import { AppDatabase } from '@core/services/database/app.database';
import { Base64 } from '../../helpers';
import { SignalProtocolStore } from './signal-store';
import { withSignalLock } from './web-lock';

const DEVICE_ID = 1; // single active device per user
const SIGNED_PREKEY_ID = 1;
export const INITIAL_PREKEY_COUNT = 50;
export const PREKEY_LOW_WATERMARK = 10;
export const PREKEY_REPLENISH_BATCH = 50;

@Injectable({ providedIn: 'root' })
export class SignalSessionService {
  private readonly store = inject(SignalProtocolStore);
  private readonly appDb = inject(AppDatabase);
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private curvePromise?: Promise<Curve>;

  /** Re-exposed so ContactsService can re-pin and warn when a contact's identity key changes (carries the new key). */
  readonly identityChanged$: Observable<{ userId: string; identityKey: string }> = this.store.identityChanged$;

  /** True once this device has generated its own Signal identity. */
  hasLocalIdentity(): Promise<boolean> {
    return this.store.hasIdentity();
  }

  /**
   * Generate this device's identity, registration id, signed pre-key and an initial pool of
   * one-time pre-keys, persist them, and return the bundle to upload to the directory.
   */
  async createIdentityBundle(): Promise<KeysUploadRequest> {
    return withSignalLock(this.appDb.userId, async () => {
      const registrationId = KeyHelper.generateRegistrationId();
      const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
      await this.store.putIdentityKeyPair(identityKeyPair);
      await this.store.putRegistrationId(registrationId);

      const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, SIGNED_PREKEY_ID);
      await this.store.storeSignedPreKey(SIGNED_PREKEY_ID, signedPreKey.keyPair);

      const oneTimePreKeys = await this.generateAndStorePreKeys(INITIAL_PREKEY_COUNT);

      return {
        registrationId,
        identityKey: Base64.bufferToBase64(identityKeyPair.pubKey),
        signedPreKey: {
          keyId: SIGNED_PREKEY_ID,
          publicKey: Base64.bufferToBase64(signedPreKey.keyPair.pubKey),
          signature: Base64.bufferToBase64(signedPreKey.signature)
        },
        oneTimePreKeys
      };
    });
  }

  /** Generate and store a fresh batch of one-time pre-keys (used to replenish the server pool). */
  generateMorePreKeys(count: number): Promise<OneTimePreKeyDto[]> {
    return withSignalLock(this.appDb.userId, () => this.generateAndStorePreKeys(count));
  }

  /** Whether a ratchet session already exists for this peer (so we can skip a bundle fetch). */
  async hasSession(userId: string): Promise<boolean> {
    return (await this.store.loadSession(this.address(userId).toString())) != null;
  }

  /** Establish (or re-establish, after a key change) a session from the peer's pre-key bundle. */
  async establishSession(userId: string, bundle: PublicKeySet): Promise<void> {
    await withSignalLock(this.appDb.userId, async () => {
      const builder = new SessionBuilder(this.store, this.address(userId));
      await builder.processPreKey({
        identityKey: Base64.base64ToBuffer(bundle.identityKey),
        registrationId: bundle.registrationId,
        signedPreKey: {
          keyId: bundle.signedPreKey.keyId,
          publicKey: Base64.base64ToBuffer(bundle.signedPreKey.publicKey),
          signature: Base64.base64ToBuffer(bundle.signedPreKey.signature)
        },
        preKey: bundle.oneTimePreKey
          ? { keyId: bundle.oneTimePreKey.keyId, publicKey: Base64.base64ToBuffer(bundle.oneTimePreKey.publicKey) }
          : undefined
      });
    });
  }

  /** Encrypt plaintext for a peer; returns the wire payload `'<sessionType>.<bodyBase64>'`. */
  async encrypt(userId: string, plaintext: string): Promise<string> {
    return withSignalLock(this.appDb.userId, async () => {
      const cipher = new SessionCipher(this.store, this.address(userId));
      const message = await cipher.encrypt(this.encoder.encode(plaintext).buffer as ArrayBuffer);
      return `${message.type}.${btoa(message.body ?? '')}`;
    });
  }

  /** Decrypt a wire payload from a peer; throws if there is no session or the message is corrupt. */
  async decrypt(userId: string, payload: string): Promise<string> {
    return withSignalLock(this.appDb.userId, async () => {
      const dot = payload.indexOf('.');
      const type = Number(payload.slice(0, dot));
      const body = atob(payload.slice(dot + 1));
      const cipher = new SessionCipher(this.store, this.address(userId));
      const plain = type === 3
        ? await cipher.decryptPreKeyWhisperMessage(body, 'binary')
        : await cipher.decryptWhisperMessage(body, 'binary');
      return this.decoder.decode(plain);
    });
  }

  /** Sign a receipt payload with our Curve25519 identity private key; returns a Base64 signature. */
  async signReceipt(message: string): Promise<string> {
    const keyPair = await this.store.getIdentityKeyPair();
    if (!keyPair) throw new Error('Cannot sign receipt: local Signal identity is missing.');
    const curve = await this.getCurve();
    const sig = curve.calculateSignature(keyPair.privKey, this.encoder.encode(message).buffer as ArrayBuffer);
    return Base64.bufferToBase64(sig);
  }

  /** Verify a receipt signature against a contact's Base64 Curve25519 identity key. */
  async verifyReceipt(identityKeyB64: string, message: string, signatureB64: string): Promise<boolean> {
    try {
      const curve = await this.getCurve();
      // NOTE: the sync Curve.verifySignature follows the NaCl convention and returns TRUE when the
      // signature is INVALID (0 = valid). It is NOT inverted by the wrapper, so we negate it here.
      const invalid = curve.verifySignature(
        Base64.base64ToBuffer(identityKeyB64),
        this.encoder.encode(message).buffer as ArrayBuffer,
        Base64.base64ToBuffer(signatureB64)
      );
      return !invalid;
    } catch {
      return false;
    }
  }

  /** Wipe all local Signal state, forcing a fresh identity on next login (key-change warning). */
  wipe(): Promise<void> {
    return this.store.wipe();
  }

  // --- internals -----------------------------------------------------------------------
  private async generateAndStorePreKeys(count: number): Promise<OneTimePreKeyDto[]> {
    const ids = await this.store.takePreKeyIds(count);
    const dtos: OneTimePreKeyDto[] = [];
    for (const keyId of ids) {
      const preKey = await KeyHelper.generatePreKey(keyId);
      await this.store.storePreKey(keyId, preKey.keyPair);
      dtos.push({ keyId, publicKey: Base64.bufferToBase64(preKey.keyPair.pubKey) });
    }
    return dtos;
  }

  private address(userId: string): SignalProtocolAddress {
    return new SignalProtocolAddress(userId, DEVICE_ID);
  }

  private getCurve(): Promise<Curve> {
    this.curvePromise ??= SignalProtocol().then(lib => lib.Curve);
    return this.curvePromise;
  }
}
