// This service now only does at-rest DB encryption (AES-GCM master key) and the identity-key
// fingerprint used to detect contact key rotations.
import { Injectable } from '@angular/core';
import { Base64 } from '../helpers';

@Injectable({
  providedIn: 'root'
})
export class CryptoService {
  static readonly ALG_AES_GCM = 'AES-GCM';
  static readonly HASH_SHA256 = 'SHA-256';
  static readonly KEY_LEN_256 = 256;

  static readonly USAGE_ENCRYPT_DECRYPT: KeyUsage[] = ['encrypt', 'decrypt'];

  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  /**
   * Generates an AES-GCM 256-bit master key for IndexedDB encryption at rest.
   * The key is marked as non-extractable, ensuring scripts cannot read its raw bytes.
   */
  async generateDbMasterKey(): Promise<CryptoKey> {
    return await window.crypto.subtle.generateKey(
      { name: CryptoService.ALG_AES_GCM, length: CryptoService.KEY_LEN_256 },
      false, // non-extractable
      CryptoService.USAGE_ENCRYPT_DECRYPT
    );
  }

  /** SHA-256 fingerprint of a contact's Base64 Curve25519 identity key — the pinned identity. */
  async fingerprintIdentityKey(identityKeyB64: string): Promise<string> {
    const data = this.encoder.encode(identityKeyB64);
    const digest = await window.crypto.subtle.digest(CryptoService.HASH_SHA256, data);
    return Base64.bufferToBase64(digest);
  }

  // --- At-Rest Encrypt / Decrypt (Database) ---

  async encryptDB(plaintext: string, masterKey: CryptoKey): Promise<string> {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const data = this.encoder.encode(plaintext);
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: CryptoService.ALG_AES_GCM, iv },
      masterKey,
      data
    );

    const ivB64 = Base64.bufferToBase64(iv.buffer);
    const cipherB64 = Base64.bufferToBase64(ciphertext);
    return `${ivB64}.${cipherB64}`;
  }

  async decryptDB(payload: string, masterKey: CryptoKey): Promise<string> {
    const parts = payload.split('.');
    if (parts.length !== 2) {
      throw new Error('Invalid DB payload format');
    }

    const [ivB64, cipherB64] = parts;
    const iv = new Uint8Array(Base64.base64ToBuffer(ivB64));
    const ciphertext = Base64.base64ToBuffer(cipherB64);

    const decrypted = await window.crypto.subtle.decrypt(
      { name: CryptoService.ALG_AES_GCM, iv },
      masterKey,
      ciphertext
    );

    return this.decoder.decode(decrypted);
  }
}