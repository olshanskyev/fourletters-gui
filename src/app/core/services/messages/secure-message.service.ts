import { Injectable, inject } from '@angular/core';
import { CryptoService } from '@core/services/crypto/crypto.service';
import { AppDatabase } from '@core/services/database/app.database';
import { KeysApiService } from '@core/services/crypto/keys-api.service';
import { AuthService } from '@core/services/authentication/auth.service';
import { lastValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class SecureMessageService {
  static readonly MAX_CACHE_SIZE = 200;
  private crypto = inject(CryptoService);
  private appDb = inject(AppDatabase);
  private keysApi = inject(KeysApiService);
  private authService = inject(AuthService);

  private memoryCache = new Map<string, string>(); // messageId -> plaintext cache

  /**
   * Fetches (from directory or local cache) and returns a user's Public Keys.
   */
  async getContactKeys(userId: string) {
    let contact = await this.appDb.contacts.get(userId);
    if (!contact) {
      const remoteKeys = await lastValueFrom(this.keysApi.getUserKeys(userId));
      const signingPublicKey = await this.crypto.importIdentityPublicKey(
        remoteKeys.keys.signingPublicKey
      );
      const encryptionPublicKey = await this.crypto.importEncryptionPublicKey(
        remoteKeys.keys.encryptionPublicKey
      );

      contact = { id: userId, signingPublicKey, encryptionPublicKey };
      await this.appDb.contacts.put(contact);
    }
    return contact;
  }

  /**
   * E2E Encrypts and Signs an outgoing message payload.
   */
  async buildOutgoingPayload(
    recipientId: string,
    plaintext: string
  ): Promise<{ payload: string; signature: string }> {
    const contact = await this.getContactKeys(recipientId);

    // 1. Encrypt text for recipient
    const e2ePayload = await this.crypto.encodeE2E(plaintext, contact.encryptionPublicKey);

    // 2. Sign the cipher payload with our Identity Private Key
    const myIdentityPair = await this.appDb.identity.get('identityKeyPair');
    if (!myIdentityPair) throw new Error('Local identity keys missing.');

    const signature = await this.crypto.sign(e2ePayload, myIdentityPair.value.privateKey);

    return { payload: e2ePayload, signature };
  }

  /**
   * Verifies & Decrypts an incoming E2E message.
   */
  async unpackIncomingPayload(
    senderId: string,
    payload: string,
    signature: string
  ): Promise<string> {
    const contact = await this.getContactKeys(senderId);

    // 1. Verify signature
    const isValid = await this.crypto.verify(payload, signature, contact.signingPublicKey);
    if (!isValid) {
      throw new Error(`Invalid signature from sender ${senderId}. Dropping payload.`);
    }

    // 2. Decrypt message
    const myEncryptionPair = await this.appDb.identity.get('encryptionKeyPair');
    if (!myEncryptionPair) throw new Error('Local encryption keys missing.');

    const plaintext = await this.crypto.decodeE2E(payload, myEncryptionPair.value.privateKey);
    return plaintext;
  }

  /**
   * Memory-caches the plaintext and returns the at-rest AES-256 encrypted payload for storage.
   */
  async encryptForAtRest(messageId: string, plaintext: string): Promise<string> {
    this.memoryCache.set(messageId, plaintext);

    const masterKeyRecord = await this.appDb.meta.get('dbMasterKey');
    if (!masterKeyRecord) throw new Error('Missing AES-GCM Master Key.');

    return this.crypto.encryptDB(plaintext, masterKeyRecord.value);
  }

  /**
   * Reads from volatile memory cache, or dynamically decrypts an at-rest message ciphertext on demand.
   */
  async decryptFromAtRest(messageId: string, ciphertext: string): Promise<string> {
    if (this.memoryCache.has(messageId)) {
      return this.memoryCache.get(messageId)!;
    }

    const masterKeyRecord = await this.appDb.meta.get('dbMasterKey');
    if (!masterKeyRecord) throw new Error('Missing AES-GCM Master Key.');

    const plaintext = await this.crypto.decryptDB(ciphertext, masterKeyRecord.value);

    // Enforce loose LRU limit
    if (this.memoryCache.size > SecureMessageService.MAX_CACHE_SIZE) {
      const firstKey = this.memoryCache.keys().next().value;
      if (firstKey) this.memoryCache.delete(firstKey);
    }

    this.memoryCache.set(messageId, plaintext);
    return plaintext;
  }

  /**
   * Generates an ECDSA signature for a standard Delivery/Read Receipt.
   */
  async signReceipt(messageId: string, type: string, originalSenderId: string): Promise<string> {
    const payload = `${messageId}:${type}:${originalSenderId}`;
    const myIdentityPair = await this.appDb.identity.get('identityKeyPair');
    if (!myIdentityPair) throw new Error('Local identity keys missing.');

    return this.crypto.sign(payload, myIdentityPair.value.privateKey);
  }

  /**
   * Verifies an incoming ECDSA signature attached to a Delivery/Read Receipt.
   */
  async verifyReceipt(
    messageId: string,
    type: string,
    receiptSenderId: string,
    signature: string
  ): Promise<boolean> {
    const myId = this.authService.currentUser()?.id;
    if (!myId) {
      console.warn('Cannot verify receipt: my user ID is unknown (not logged in).');
      return false;
    }

    // Security check: ensure the receipt is actually from the person we sent the message to
    const originalMessage = await this.appDb.messages.get(messageId);
    if (!originalMessage || !originalMessage.isMine) {
      console.warn(`Cannot verify receipt: outgoing message ${messageId} not found in local outbox.`);
      return false;
    }

    if (originalMessage.recipientId !== receiptSenderId) {
      console.warn(`Forged receipt rejected! Expected receipt from ${originalMessage.recipientId}, but got it from ${receiptSenderId}.`);
      return false;
    }

    const payload = `${messageId}:${type}:${myId}`; // Our ID (the original sender)
    const contact = await this.getContactKeys(receiptSenderId); // The sender of the receipt

    return this.crypto.verify(payload, signature, contact.signingPublicKey);
  }

  /**
   * Ensure memory is erased upon lock or logout
   */
  clearMemory() {
    this.memoryCache.clear();
  }
}