import { Injectable, inject } from '@angular/core';
import { CryptoService } from '@core/services/crypto';
import { SignalSessionService } from '@core/services/crypto/signal';
import { MessagesRepository } from './messages.repository';
import { ContactsService } from '@core/services/contacts';
import { IdentityService } from '@core/services/identity';
import { AuthService } from '@core/services/authentication/auth.service';
import { GroupsService } from '@core/services/groups/groups.service';

/**
 * Thrown when an incoming 1:1 payload cannot be decrypted — no session yet, a corrupt/duplicate
 * ratchet message, or a one-time pre-key that was already consumed (we rotated keys on a new device).
 */
export class UndecryptableError extends Error {
  constructor(public readonly senderId: string, cause?: unknown) {
    super(`Cannot decrypt 1:1 payload from ${senderId} (no usable ratchet session).`);
    this.name = 'UndecryptableError';
    this.cause = cause;
  }
}

@Injectable({
  providedIn: 'root'
})
export class SecureMessageService {
  static readonly MAX_CACHE_SIZE = 200;
  private crypto = inject(CryptoService);
  private signal = inject(SignalSessionService);
  private messagesRepo = inject(MessagesRepository);
  private contacts = inject(ContactsService);
  private identity = inject(IdentityService);
  private authService = inject(AuthService);
  private groups = inject(GroupsService);

  private memoryCache = new Map<string, string>(); // messageId -> plaintext cache

  /**
   * Encrypt an outgoing message through the recipient's ratchet session, opening one from their
   * pre-key bundle if needed. Pass forceNewSession=true to re-key after the recipient changed device.
   */
  async buildOutgoingPayload(
    recipientId: string,
    plaintext: string,
    forceNewSession = false
  ): Promise<{ payload: string }> {
    if (forceNewSession || !(await this.signal.hasSession(recipientId))) {
      const bundle = await this.contacts.getContactBundle(recipientId);
      await this.signal.establishSession(recipientId, bundle);
    }
    const payload = await this.signal.encrypt(recipientId, plaintext);
    return { payload };
  }

  /**
   * Decrypt an incoming ratchet payload. A failure means there is no usable session (the sender
   * sealed it to a stale device key) — surface it so the caller can NACK.
   */
  async unpackIncomingPayload(senderId: string, payload: string): Promise<string> {
    try {
      return await this.signal.decrypt(senderId, payload);
    } catch (err) {
      throw new UndecryptableError(senderId, err);
    }
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
   * Signs a Delivery/Read/Undecryptable receipt with our Curve25519 identity key.
   */
  async signReceipt(messageId: string, type: string, originalSenderId: string): Promise<string> {
    const payload = `${messageId}:${type}:${originalSenderId}`;
    return this.signal.signReceipt(payload);
  }

  /**
   * Verifies the Curve25519 signature on an incoming Delivery/Read receipt.
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

    if (originalMessage.kind === 'group') {
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
    return this.verifyWithPin(receiptSenderId, payload, signature); // The sender of the receipt
  }

  /**
   * Ensure memory is erased upon lock or logout
   */
  clearMemory() {
    this.memoryCache.clear();
  }

  // --- Shared helpers -------------------------------------------------------------------

  /**
   * Verify a receipt signature against the sender's pinned identity key. On failure, re-fetch the
   * directory key once; an unchanged or still-failing key is a genuine bad signature.
   */
  private async verifyWithPin(senderId: string, payload: string, signature: string)
    : Promise<boolean> {
    const contact = await this.contacts.getContactRecord(senderId);
    if (await this.signal.verifyReceipt(contact.identityKey, payload, signature)) {
      return true;
    }

    const refreshed = await this.contacts.refreshContactKey(senderId);
    if (refreshed.keyFingerprint === contact.keyFingerprint) {
      return false; // key did not change → the signature is genuinely invalid
    }
    return this.signal.verifyReceipt(refreshed.identityKey, payload, signature);
  }
}