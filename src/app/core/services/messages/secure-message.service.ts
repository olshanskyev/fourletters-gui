import { Injectable, inject } from '@angular/core';
import { CryptoService } from '@core/services/crypto';
import { MessagesRepository } from './messages.repository';
import { ContactsService } from '@core/services/contacts';
import { IdentityService } from '@core/services/identity';
import { AuthService } from '@core/services/authentication/auth.service';
import { GroupKeyService } from '@core/services/groups/group-key.service';
import { GroupsService } from '@core/services/groups/groups.service';

@Injectable({
  providedIn: 'root'
})
export class SecureMessageService {
  static readonly MAX_CACHE_SIZE = 200;
  private crypto = inject(CryptoService);
  private messagesRepo = inject(MessagesRepository);
  private contacts = inject(ContactsService);
  private identity = inject(IdentityService);
  private authService = inject(AuthService);
  private groupKeys = inject(GroupKeyService);
  private groups = inject(GroupsService);

  private memoryCache = new Map<string, string>(); // messageId -> plaintext cache

  /**
   * E2E Encrypts and Signs an outgoing message payload.
   */
  async buildOutgoingPayload(
    recipientId: string,
    plaintext: string
  ): Promise<{ payload: string; signature: string }> {
    const contact = await this.contacts.getContactKeys(recipientId);
    const e2ePayload = await this.crypto.encodeE2E(plaintext, contact.encryptionPublicKey);
    const signature = await this.signWithIdentity(e2ePayload);
    return { payload: e2ePayload, signature };
  }

  /**
   * Encrypts a group message once under the current epoch's sender-key and signs it with our
   * identity key.
   */
  async buildOutgoingGroupPayload(
    groupId: string,
    plaintext: string
  ): Promise<{ payload: string; signature: string; epoch: number }> {
    const { key, epoch } = await this.groupKeys.ensureCurrentKey(groupId);
    const payload = await this.crypto.encryptGroup(plaintext, key);
    const signature = await this.signWithIdentity(payload);
    return { payload, signature, epoch };
  }

  /**
   * Verifies & Decrypts an incoming E2E message.
   */
  async unpackIncomingPayload(
    senderId: string,
    payload: string,
    signature: string
  ): Promise<string> {
    // 1. Verify signature
    await this.verifySender(senderId, payload, signature);

    // 2. Decrypt message
    const myEncryptionPrivateKey = await this.identity.getEncryptionPrivateKey();
    return this.crypto.decodeE2E(payload, myEncryptionPrivateKey);
  }

  /**
   * Verifies & Decrypts an incoming group message.
   */
  async unpackIncomingGroupPayload(
    groupId: string,
    epoch: number,
    senderId: string,
    payload: string,
    signature: string
  ): Promise<string> {
    await this.verifySender(senderId, payload, signature);

    const groupKey = await this.groupKeys.ensureKey(groupId, epoch);
    return this.crypto.decryptGroup(payload, groupKey);
  }



  /**
   * Memory-caches the plaintext and returns the at-rest AES-256 encrypted payload for storage.
   */
  async encryptForAtRest(messageId: string, plaintext: string): Promise<string> {
    this.memoryCache.set(messageId, plaintext);

    const masterKey = await this.identity.getDbMasterKey();
    return this.crypto.encryptDB(plaintext, masterKey);
  }

  /**
   * Reads from volatile memory cache, or dynamically decrypts an at-rest message ciphertext on demand.
   */
  async decryptFromAtRest(messageId: string, ciphertext: string): Promise<string> {
    if (this.memoryCache.has(messageId)) {
      return this.memoryCache.get(messageId)!;
    }

    const masterKey = await this.identity.getDbMasterKey();
    const plaintext = await this.crypto.decryptDB(ciphertext, masterKey);

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
    return this.signWithIdentity(payload);
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
    const originalMessage = await this.messagesRepo.getMessageById(messageId);
    if (!originalMessage || !originalMessage.isMine) {
      console.warn(`Cannot verify receipt: outgoing message ${messageId} not found in local outbox.`);
      return false;
    }

    if (originalMessage.groupId) {
      // Group message: any current member may legitimately acknowledge — authorize by roster membership.
      const isMember = await this.groups.isMember(originalMessage.groupId, receiptSenderId);
      if (!isMember) {
        console.warn(`Forged group receipt rejected! ${receiptSenderId} is not a member of group ${originalMessage.groupId}.`);
        return false;
      }
    } else if (originalMessage.recipientId !== receiptSenderId) {
      console.warn(`Forged receipt rejected! Expected receipt from ${originalMessage.recipientId}, but got it from ${receiptSenderId}.`);
      return false;
    }

    const payload = `${messageId}:${type}:${myId}`; // Our ID (the original sender)
    const contact = await this.contacts.getContactKeys(receiptSenderId); // The sender of the receipt

    return this.crypto.verify(payload, signature, contact.signingPublicKey);
  }

  /**
   * Ensure memory is erased upon lock or logout
   */
  clearMemory() {
    this.memoryCache.clear();
  }

  // --- Shared key helpers ---------------------------------------------------------------

  /** Signs a payload with our long-lived identity private key. */
  private async signWithIdentity(payload: string): Promise<string> {
    const signingPrivateKey = await this.identity.getSigningPrivateKey();
    return this.crypto.sign(payload, signingPrivateKey);
  }

  /** Verifies a payload's signature against a sender's directory signing key; throws if invalid. */
  private async verifySender(senderId: string, payload: string, signature: string): Promise<void> {
    const contact = await this.contacts.getContactKeys(senderId);
    const isValid = await this.crypto.verify(payload, signature, contact.signingPublicKey);
    if (!isValid) {
      throw new Error(`Invalid signature from sender ${senderId}. Dropping payload.`);
    }
  }
}