import { Injectable, inject } from '@angular/core';
import { CryptoService } from '@core/services/crypto';
import { SignalSessionService } from '@core/services/crypto/signal';
import { GroupCipherService, SenderKeyDistribution } from '@core/services/crypto/group';
import { MessagesRepository } from './messages.repository';
import { MessageContent, MessageContentType } from './models/messages.model';
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

/**
 * The end-to-end encrypted content of a chat message, shared by the 1:1 and group transports.
 * `ts` is the sender's send time (epoch ms) so every device orders the message the same way; `ct`
 * is the content type ([MessageContentType]) and `x` the content payload.
 */
export interface ChatBody {
  ts: number;
  ct: MessageContentType;
  x: string;
}

/** A decoded {@link ChatBody}: the parsed content plus the sender's send time (epoch ms). */
export interface DecodedContent { content: MessageContent; ts?: number }

/**
 * A decrypted pairwise (1:1) payload. It is either an ordinary chat message, a Sender Key
 * Distribution Message (SKDM) that carries a peer's group Sender Key, or a group message
 * re-delivered over the 1:1 ratchet to a member that could not decrypt the group copy. All travel
 * over the same Double Ratchet session and are distinguished by a small control envelope. The chat
 * and re-delivery variants carry the same parsed {@link MessageContent} a group message yields.
 */
export type PairwiseContent =
  | ({ kind: 'chat' } & DecodedContent)
  | { kind: 'skdm'; skdm: SenderKeyDistribution }
  | ({ kind: 'group-redelivery'; groupId: string } & DecodedContent);


/** Control envelope wrapping every pairwise plaintext so SKDMs and chats share one ratchet. */
type PairwiseEnvelope =
  | { t: 'chat'; b: ChatBody }
  | { t: 'skdm'; d: SenderKeyDistribution }
  | { t: 'grp'; g: string; b: ChatBody };

@Injectable({
  providedIn: 'root'
})
export class SecureMessageService {
  static readonly MAX_CACHE_SIZE = 200;
  private crypto = inject(CryptoService);
  private signal = inject(SignalSessionService);
  private groupCipher = inject(GroupCipherService);
  private messagesRepo = inject(MessagesRepository);
  private contacts = inject(ContactsService);
  private identity = inject(IdentityService);
  private authService = inject(AuthService);
  private groups = inject(GroupsService);

  private memoryCache = new Map<string, string>(); // messageId -> plaintext cache

  /**
   * Encrypt an outgoing chat message through the recipient's ratchet session, opening one from their
   * pre-key bundle if needed. Pass forceNewSession=true to re-key after the recipient changed device.
   */
  async buildOutgoingPayload(
    recipientId: string,
    plaintext: string,
    ts: number,
    forceNewSession = false,
    ct: MessageContentType = 'text'
  ): Promise<{ payload: string }> {
    const envelope: PairwiseEnvelope = { t: 'chat', b: this.contentBody(ts, ct, plaintext) };
    return { payload: await this.encryptPairwise(recipientId, envelope, forceNewSession) };
  }

  /**
   * Encrypt a Sender Key Distribution Message to a group member over the pairwise ratchet
   */
  async buildDistributionPayload(
    recipientId: string,
    skdm: SenderKeyDistribution
  ): Promise<{ payload: string }> {
    const envelope: PairwiseEnvelope = { t: 'skdm', d: skdm };
    return { payload: await this.encryptPairwise(recipientId, envelope, false) };
  }

  /**
   * Re-encrypt a group message's plaintext over the pairwise ratchet to a single member that
   * NACK'd the group copy (new device).
   */
  async buildGroupRedeliveryPayload(
    recipientId: string,
    groupId: string,
    plaintext: string,
    ts: number,
    ct: MessageContentType = 'text'
  ): Promise<{ payload: string }> {
    const envelope: PairwiseEnvelope = { t: 'grp', g: groupId, b: this.contentBody(ts, ct, plaintext) };
    return { payload: await this.encryptPairwise(recipientId, envelope, true) };
  }

  /** Encrypt a group chat message once with this device's Sender Key for the group epoch. */
  async buildGroupPayload(
    groupId: string,
    epoch: number,
    plaintext: string,
    ts: number,
    ct: MessageContentType = 'text'
  ): Promise<{ payload: string }> {
    const payload = await this.groupCipher.encrypt(
      groupId, epoch, JSON.stringify(this.contentBody(ts, ct, plaintext))
    );
    return { payload };
  }

  /**
   * Decrypt an incoming pairwise ratchet payload into either a chat message or an SKDM. A failure
   * means there is no usable session (the sender sealed it to a stale device key) — surface it so
   * the caller can NACK.
   */
  async unpackIncomingPayload(senderId: string, payload: string): Promise<PairwiseContent> {
    let plaintext: string;
    try {
      plaintext = await this.signal.decrypt(senderId, payload);
    } catch (err) {
      throw new UndecryptableError(senderId, err);
    }

    let envelope: PairwiseEnvelope;
    try {
      envelope = JSON.parse(plaintext);
    } catch {
      // Authenticated plaintext that isn't an envelope: a plain (non-enveloped) chat body.
      const { content, ts } = this.contentFromBody(undefined);
      return { kind: 'chat', content, ts };
    }
    if (envelope.t === 'skdm') {
      return { kind: 'skdm', skdm: envelope.d };
    }
    if (envelope.t === 'grp') {
      const { content, ts } = this.contentFromBody(envelope.b);
      return { kind: 'group-redelivery', groupId: envelope.g, content, ts };
    }
    const { content, ts } = this.contentFromBody(envelope.b);
    return { kind: 'chat', content, ts };
  }

  async unpackGroupPayload(senderId: string, groupId: string, payload: string)
    : Promise<DecodedContent> {
    const plaintext = await this.groupCipher.decrypt(senderId, groupId, payload);
    let candidate: unknown;
    try {
      candidate = JSON.parse(plaintext);
    } catch {
      // Authenticated plaintext that isn't JSON: fall back to a plain body.
      candidate = undefined;
    }
    return this.contentFromBody(candidate);
  }

  /** Wrap chat content in the shared envelope (sender time + content type). */
  private contentBody(ts: number, ct: MessageContentType, x: string): ChatBody {
    return { ts, ct, x };
  }

  private contentFromBody(body: unknown): DecodedContent {
    if (this.isChatBody(body)) {
      const ts = typeof body.ts === 'number' ? body.ts : undefined;
      // Preserve known content types; anything unrecognized degrades to text so nothing is lost.
      const type: MessageContentType = body.ct === 'image' ? 'image' : 'text';
      return { content: { type, text: body.x }, ts };
    }
    console.error('Unexpected message body; cannot parse content', body);
    return { content: { type: 'text', text: '' } };
  }

  private isChatBody(body: unknown): body is ChatBody {
    return typeof body === 'object' && body !== null && typeof (body as ChatBody).x === 'string';
  }

  async applyDistribution(senderId: string, skdm: SenderKeyDistribution): Promise<void> {
    await this.groupCipher.applyDistribution(senderId, skdm);
  }

  async buildDistribution(groupId: string, epoch: number): Promise<SenderKeyDistribution> {
    return this.groupCipher.buildDistribution(groupId, epoch);
  }

  async distributedMembers(groupId: string, epoch: number): Promise<string[]> {
    return this.groupCipher.distributedMembers(groupId, epoch);
  }

  async markDistributed(groupId: string, epoch: number, members: string[]): Promise<void> {
    await this.groupCipher.markDistributed(groupId, epoch, members);
  }

  async clearDistribution(groupId: string, epoch: number, memberId: string): Promise<void> {
    await this.groupCipher.clearDistribution(groupId, epoch, memberId);
  }

  // --- Shared pairwise helper ----------------------------------------------------------
  private async encryptPairwise(
    recipientId: string,
    envelope: PairwiseEnvelope,
    forceNewSession: boolean
  ): Promise<string> {
    if (forceNewSession || !(await this.signal.hasSession(recipientId))) {
      const bundle = await this.contacts.getContactBundle(recipientId);
      await this.signal.establishSession(recipientId, bundle);
    }
    return this.signal.encrypt(recipientId, JSON.stringify(envelope));
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
      console.debug('Cannot verify receipt: my user ID is unknown (not logged in).');
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