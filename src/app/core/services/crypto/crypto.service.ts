import { Injectable } from '@angular/core';
import { Base64 } from '../helpers';

@Injectable({
  providedIn: 'root'
})
export class CryptoService {
  static readonly ALG_AES_GCM = 'AES-GCM';
  static readonly ALG_ECDSA = 'ECDSA';
  static readonly ALG_ECDH = 'ECDH';
  static readonly CURVE_P256 = 'P-256';
  static readonly HASH_SHA256 = 'SHA-256';
  static readonly FORMAT_SPKI = 'spki';
  static readonly FORMAT_RAW = 'raw';
  static readonly KEY_LEN_256 = 256;

  static readonly USAGE_ENCRYPT_DECRYPT: KeyUsage[] = ['encrypt', 'decrypt'];
  static readonly USAGE_ENCRYPT: KeyUsage[] = ['encrypt'];
  static readonly USAGE_DECRYPT: KeyUsage[] = ['decrypt'];
  static readonly USAGE_SIGN_VERIFY: KeyUsage[] = ['sign', 'verify'];
  static readonly USAGE_VERIFY: KeyUsage[] = ['verify'];
  static readonly USAGE_DERIVE: KeyUsage[] = ['deriveKey', 'deriveBits'];

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

  /**
   * Generates an ECDSA P-256 key pair for signing and verifying messages.
   * Private key is non-extractable.
   */
  async generateIdentityKeyPair(): Promise<CryptoKeyPair> {
    return await window.crypto.subtle.generateKey(
      { name: CryptoService.ALG_ECDSA, namedCurve: CryptoService.CURVE_P256 },
      false, // non-extractable private key
      CryptoService.USAGE_SIGN_VERIFY
    );
  }

  /**
   * Generates an ECDH P-256 key pair for deriving shared secrets for E2E encryption.
   * Private key is non-extractable.
   */
  async generateEncryptionKeyPair(): Promise<CryptoKeyPair> {
    return await window.crypto.subtle.generateKey(
      { name: CryptoService.ALG_ECDH, namedCurve: CryptoService.CURVE_P256 },
      false, // non-extractable private key
      CryptoService.USAGE_DERIVE
    );
  }

  /**
   * Exports a public key to Base64 (SPKI format) to be uploaded to the Server directory.
   */
  async exportPublicKeyBase64(key: CryptoKey): Promise<string> {
    const exported = await window.crypto.subtle.exportKey(CryptoService.FORMAT_SPKI, key);
    return Base64.bufferToBase64(exported);
  }

  /**
   * Imports a remote user's Base64 public key for identity verification (ECDSA).
   */
  async importIdentityPublicKey(base64Key: string): Promise<CryptoKey> {
    return this.importPublicKey(base64Key, CryptoService.ALG_ECDSA);
  }

  /**
   * Imports a remote user's Base64 public key for E2E encryption/derivation (ECDH).
   */
  async importEncryptionPublicKey(base64Key: string): Promise<CryptoKey> {
    return this.importPublicKey(base64Key, CryptoService.ALG_ECDH);
  }

  private async importPublicKey(base64Key: string, algorithm: 'ECDSA' | 'ECDH'): Promise<CryptoKey> {
    const buffer = Base64.base64ToBuffer(base64Key);
    return await window.crypto.subtle.importKey(
      CryptoService.FORMAT_SPKI,
      buffer,
      { name: algorithm, namedCurve: CryptoService.CURVE_P256 },
      true,
      algorithm === CryptoService.ALG_ECDSA ? CryptoService.USAGE_VERIFY : []
    );
  }

  // --- E2E Sign / Verify ---

  async sign(payload: string, privateKey: CryptoKey): Promise<string> {
    const data = this.encoder.encode(payload);
    const signature = await window.crypto.subtle.sign(
      { name: CryptoService.ALG_ECDSA, hash: { name: CryptoService.HASH_SHA256 } },
      privateKey,
      data
    );
    return Base64.bufferToBase64(signature);
  }

  async verify(payload: string, signatureBase64: string, publicKey: CryptoKey): Promise<boolean> {
    const data = this.encoder.encode(payload);
    const signature = Base64.base64ToBuffer(signatureBase64);
    return await window.crypto.subtle.verify(
      { name: CryptoService.ALG_ECDSA, hash: { name: CryptoService.HASH_SHA256 } },
      publicKey,
      signature,
      data
    );
  }

  // --- E2E Encrypt / Decrypt ---

  async encodeE2E(plaintext: string, recipientPublicKey: CryptoKey): Promise<string> {
    // 1. Generate ephemeral ECDH keypair
    const ephemeralKeyPair = await this.generateEncryptionKeyPair();

    // 2. Derive AES-GCM key from DH shared secret
    const aesKey = await window.crypto.subtle.deriveKey(
      { name: CryptoService.ALG_ECDH, public: recipientPublicKey },
      ephemeralKeyPair.privateKey,
      { name: CryptoService.ALG_AES_GCM, length: CryptoService.KEY_LEN_256 },
      false,
      CryptoService.USAGE_ENCRYPT
    );

    // 3. Encrypt payload with random IV
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const data = this.encoder.encode(plaintext);
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: CryptoService.ALG_AES_GCM, iv },
      aesKey,
      data
    );

    // 4. Combine into a delimited format: "ephemeralPubB64.ivB64.cipherB64"
    const ephemeralPubB64 = await this.exportPublicKeyBase64(ephemeralKeyPair.publicKey);
    const ivB64 = Base64.bufferToBase64(iv.buffer);
    const cipherB64 = Base64.bufferToBase64(ciphertext);

    return `${ephemeralPubB64}.${ivB64}.${cipherB64}`;
  }

  async decodeE2E(payload: string, myPrivateKey: CryptoKey): Promise<string> {
    const parts = payload.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid E2E payload format');
    }

    const [ephemeralPubB64, ivB64, cipherB64] = parts;

    // 1. Parse payload metadata
    const ephemeralPub = await this.importEncryptionPublicKey(ephemeralPubB64);
    const iv = new Uint8Array(Base64.base64ToBuffer(ivB64));
    const ciphertext = Base64.base64ToBuffer(cipherB64);

    // 2. Derive decryption key from ephemeral public segment
    const aesKey = await window.crypto.subtle.deriveKey(
      { name: CryptoService.ALG_ECDH, public: ephemeralPub },
      myPrivateKey,
      { name: CryptoService.ALG_AES_GCM, length: CryptoService.KEY_LEN_256 },
      false,
      CryptoService.USAGE_DECRYPT
    );

    // 3. Decrypt ciphertext
    const decrypted = await window.crypto.subtle.decrypt(
      { name: CryptoService.ALG_AES_GCM, iv },
      aesKey,
      ciphertext
    );

    return this.decoder.decode(decrypted);
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

  // --- Group Sender-Key (symmetric epoch key + per-recipient wrapping) ---

  /**
   * Generates an AES-GCM 256-bit symmetric group key for one epoch. Extractable so it can be
   * wrapped (sealed) to each member's encryption key before distribution; the wrapped blobs are
   * what leave the device, never the raw key.
   */
  async generateGroupKey(): Promise<CryptoKey> {
    return await window.crypto.subtle.generateKey(
      { name: CryptoService.ALG_AES_GCM, length: CryptoService.KEY_LEN_256 },
      true, // extractable so it can be sealed per-recipient
      CryptoService.USAGE_ENCRYPT_DECRYPT
    );
  }

  /**
   * Seals a group key to a single member by exporting its raw bytes and encrypting them to the
   * recipient's ECDH encryption key, reusing the same ephemeral-ECDH + AES-GCM envelope as 1:1
   * payloads. Returns the wrapped blob "ephemeralPubB64.ivB64.cipherB64".
   */
  async wrapGroupKeyFor(groupKey: CryptoKey, recipientPublicKey: CryptoKey): Promise<string> {
    const raw = await window.crypto.subtle.exportKey(CryptoService.FORMAT_RAW, groupKey);
    const rawB64 = Base64.bufferToBase64(raw);
    return this.encodeE2E(rawB64, recipientPublicKey);
  }

  /**
   * Unseals a wrapped group key blob with the caller's ECDH private key and imports the recovered
   * bytes as a non-extractable AES-GCM key usable only for group encrypt/decrypt.
   */
  async unwrapGroupKey(wrappedKey: string, myPrivateKey: CryptoKey): Promise<CryptoKey> {
    const rawB64 = await this.decodeE2E(wrappedKey, myPrivateKey);
    const raw = Base64.base64ToBuffer(rawB64);
    return await window.crypto.subtle.importKey(
      CryptoService.FORMAT_RAW,
      raw,
      { name: CryptoService.ALG_AES_GCM, length: CryptoService.KEY_LEN_256 },
      false, // non-extractable once recovered
      CryptoService.USAGE_ENCRYPT_DECRYPT
    );
  }

  /**
   * Encrypts a group message once under the shared epoch key. Returns "ivB64.cipherB64"; the epoch
   * that selects this key is carried alongside the message, not inside the payload.
   */
  async encryptGroup(plaintext: string, groupKey: CryptoKey): Promise<string> {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const data = this.encoder.encode(plaintext);
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: CryptoService.ALG_AES_GCM, iv },
      groupKey,
      data
    );

    const ivB64 = Base64.bufferToBase64(iv.buffer);
    const cipherB64 = Base64.bufferToBase64(ciphertext);
    return `${ivB64}.${cipherB64}`;
  }

  /**
   * Decrypts a group message ("ivB64.cipherB64") with the shared epoch key.
   */
  async decryptGroup(payload: string, groupKey: CryptoKey): Promise<string> {
    const parts = payload.split('.');
    if (parts.length !== 2) {
      throw new Error('Invalid group payload format');
    }

    const [ivB64, cipherB64] = parts;
    const iv = new Uint8Array(Base64.base64ToBuffer(ivB64));
    const ciphertext = Base64.base64ToBuffer(cipherB64);

    const decrypted = await window.crypto.subtle.decrypt(
      { name: CryptoService.ALG_AES_GCM, iv },
      groupKey,
      ciphertext
    );

    return this.decoder.decode(decrypted);
  }
}