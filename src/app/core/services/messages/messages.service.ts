import { Injectable, inject } from '@angular/core';
import { MessagesRepository } from './messages.repository';
import {
  LocalMessage,
  MessageContent,
  MessageContentType,
  SystemMessage,
  messagePreview
} from './models/messages.model';
import { Observable, Subscription, lastValueFrom, concatMap } from 'rxjs';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { ContactsService } from '@core/services/contacts/contacts.service';
import { UsersService } from '@core/services/users/users.service';
import { PushService } from '@core/services/push/push.service';
import { HubService } from './ws/hub.service';
import { MessagesApiService } from './messages-api.service';
import { OutboxService } from './outbox.service';
import { ReceiptType, EncryptedMessage, ReceiptData, DeliveryReceipt } from '@dto/models';
import { SyncStateRepository } from './sync-state.repository';
import { SecureMessageService, UndecryptableError } from './secure-message.service';
import { GroupUndecryptableError } from '@core/services/crypto/group';

/** A receipt we owe the sender, queued so a whole batch can be acknowledged in one request. */
interface PendingReceipt {
  messageId: string;
  senderId: string;
  type: ReceiptType;
}

@Injectable({
  providedIn: 'root'
})
export class MessagesService {
  /** How far a sender's send time may run ahead of our arrival time before we clamp it (5 min). */
  private static readonly MAX_CLOCK_SKEW = 5 * 60 * 1000;

  private repository = inject(MessagesRepository);
  private conversationsService = inject(ConversationsService);
  private contactsService = inject(ContactsService);
  private usersService = inject(UsersService);
  private pushService = inject(PushService);
  private hubService = inject(HubService);
  private messagesApi = inject(MessagesApiService);
  private outboxService = inject(OutboxService);
  private syncState = inject(SyncStateRepository);
  private secureMsg = inject(SecureMessageService);

  private incomingSubscription?: Subscription;
  private deliveredSubscription?: Subscription;
  private readSubscription?: Subscription;
  private undecryptableSubscription?: Subscription;
  private keyChangedSubscription?: Subscription;
  private connectedSubscription?: Subscription;

  /**
   * Connect to the Hub and start handling incoming live messages. Idempotent.
   * Called once by startup service when the user is authenticated.
   */
  startListening(): void {
    if (this.incomingSubscription) {
      return;
    }

    this.hubService.connect();

    // init subscriptions to live events from the Hub
    this.incomingSubscription = this.hubService.messages.pipe(
      concatMap(async (encryptedMessage) => {
        // Live arrival: may raise a local notification if the app is backgrounded but connected.
        const receipts = await this.processIncomingMessage(encryptedMessage, true);
        await this.flushReceipts(receipts);
      })
    ).subscribe();

    this.deliveredSubscription = this.hubService.messageDelivered.pipe(
      concatMap(async (receipt) => {
        if (await this.checkReceiptSignature(receipt)) {
          await this.outboxService.processReceipt(receipt.messageId, 'delivered');
        }
      })
    ).subscribe();

    this.readSubscription = this.hubService.messageRead.pipe(
      concatMap(async (receipt) => {
        if (await this.checkReceiptSignature(receipt)) {
          await this.outboxService.processReceipt(receipt.messageId, 'read');
        }
      })
    ).subscribe();

    this.undecryptableSubscription = this.hubService.messageUndecryptable.pipe(
      concatMap(async (receipt) => {
        if (await this.checkReceiptSignature(receipt)) {
          await this.outboxService.resendAfterKeyChange(receipt.messageId, receipt.recipientId);
        }
      })
    ).subscribe();

    this.keyChangedSubscription = this.contactsService.keyChanged$.pipe(
      concatMap(async ({ userId }) => {
        await this.insertIdentityChangedNotice(userId);
      })
    ).subscribe();

    // Re-sync the inbox on every reconnection so messages queued while the app was backgrounded
    // The first connection is skipped here because the explicit startup sync already covers it.
    let isFirstConnect = true;
    this.connectedSubscription = this.hubService.connected.pipe(
      concatMap(async () => {
        if (isFirstConnect) {
          isFirstConnect = false;
          return;
        }
        await this.syncInbox();
      })
    ).subscribe();

    // Initial sync + outbox resync.
    void this.syncInbox();
    try {
      this.outboxService.resync();
    } catch (err) {
      console.error('Failed to resync outbox messages after startup:', err);
    }
  }

  /**
   * Pull the server inbox and process any messages/receipts we missed while offline or suspended.
   * Runs at startup and again on each hub reconnection.
   */
  private async syncInbox(): Promise<void> {
    try {
      const res = await lastValueFrom(this.messagesApi.fetchInbox());
      if (res.serverStartedAt) {
        await this.syncState.setServerStartedAt(res.serverStartedAt);
      }

      // Save unread messages from inbox. Process 1:1 messages (which include Sender Key
      // Distribution Messages) BEFORE group messages, so a group message never fails to decrypt
      // just because its Sender Key arrived in the same batch.
      const inbox = res.messages || [];
      const direct = inbox.filter(m => !(m as any).groupId);
      const group = inbox.filter(m => (m as any).groupId);
      // Acknowledge the whole batch in one request instead of one round-trip per message.
      const pending: PendingReceipt[] = [];
      for (const encryptedMessage of [...direct, ...group]) {
        // Inbox-sync messages were delivered while we were disconnected, so the Server already
        // web-pushed them: never raise a duplicate local notification for them.
        pending.push(...await this.processIncomingMessage(encryptedMessage, false));
      }
      await this.flushReceipts(pending);

      // Process receipts for messages we sent that were delivered/read while we were offline
      for (const receipt of res.receipts || []) {
        if (!(await this.checkReceiptSignature(receipt))) {
          console.warn('Invalid receipt signature dropped', receipt);
        } else if (receipt.type === ReceiptType.Undecryptable) {
          await this.outboxService.resendAfterKeyChange(receipt.messageId, receipt.recipientId);
        } else {
          await this.outboxService.processReceipt(receipt.messageId, receipt.type as 'delivered' | 'read');
        }
      }
    } catch (err) {
      console.error('Failed to sync inbox:', err);
    }
  }

  private async checkReceiptSignature(receipt: ReceiptData): Promise<boolean> {
    return await this.secureMsg.verifyReceipt(
        receipt.messageId, receipt.type, receipt.recipientId, receipt.signature
    );
  }

  private async processIncomingMessage(encryptedMessage: EncryptedMessage | any, notify: boolean)
    : Promise<PendingReceipt[]> {
    if (!encryptedMessage.senderId) {
      console.warn('Received encrypted message without a senderId. Dropping message.', encryptedMessage);
      return [];
    }

    // De-duplicate: Ensure we don't save the same message again when unioning Hot and Cold tiers.
    // A duplicate means we stored it but the server never got our receipt
    const existing = await this.repository.hasMessage(encryptedMessage.messageId);
    if (existing) {
      const { messageId, senderId } = encryptedMessage;
      return [await this.reacknowledgeStored(messageId, senderId)];
    }

    const { senderId, messageId, groupId } = encryptedMessage;

    try {
      return groupId
        ? await this.processIncomingGroupMessage(encryptedMessage, notify)
        : await this.processIncomingDirectMessage(encryptedMessage, notify);
    } catch (err) {
      if (err instanceof UndecryptableError || err instanceof GroupUndecryptableError) {
        // The signature was valid but we lack a usable key (sealed to a previous device key, or a
        // Sender Key we never received). NACK it so the Server drops our pending copy and the sender
        // re-keys / redistributes; discard it locally.
        return [{ messageId, senderId, type: ReceiptType.Undecryptable }];
      }
      console.warn('Failed to process incoming message', messageId, err);
      return [];
    }
  }

  /**
   * Handle a pairwise (1:1) message: either an ordinary chat or a Sender Key Distribution Message
   * that silently seeds a peer's group Sender Key.
   */
  private async processIncomingDirectMessage(
    encryptedMessage: EncryptedMessage | any, notify: boolean
  )
    : Promise<PendingReceipt[]> {
    const { senderId, messageId, payload } = encryptedMessage;
    const content = await this.secureMsg.unpackIncomingPayload(senderId, payload);

    if (content.kind === 'skdm') {
      await this.secureMsg.applyDistribution(senderId, content.skdm);
      return [{ messageId, senderId, type: ReceiptType.Delivered }];
    }

    if (content.kind === 'group-redelivery') {
      // A group message re-encrypted over the 1:1 ratchet because we could not decrypt the group
      // copy (new device). It rides in as a 1:1 message but belongs in the group conversation.
      encryptedMessage.groupId = content.groupId;
      encryptedMessage.recipientId = undefined;
      return [await this.persistIncoming(encryptedMessage, content.content, notify, content.ts)];
    }

    return [await this.persistIncoming(encryptedMessage, content.content, notify, content.ts)];
  }

  /**
   * Handle a group message: decrypt it with the sender's distributed Sender Key. A missing/invalid
   * Sender Key throws GroupUndecryptableError, which the caller turns into a NACK.
   */
  private async processIncomingGroupMessage(
    encryptedMessage: EncryptedMessage | any, notify: boolean
  )
    : Promise<PendingReceipt[]> {
    const { senderId, groupId, payload } = encryptedMessage;
    const { content, ts } = await this.secureMsg.unpackGroupPayload(senderId, groupId, payload);
    return [await this.persistIncoming(encryptedMessage, content, notify, ts)];
  }

  /**
   * Resolve the conversation, store the decrypted message at rest, refresh the preview, and
   * acknowledge delivery to the original sender.
   */
  private async persistIncoming(
    encryptedMessage: EncryptedMessage | any, content: MessageContent, notify: boolean, ts?: number
  )
    : Promise<PendingReceipt> {
    const { senderId, messageId } = encryptedMessage;
    const conversationId = await this.resolveIncomingConversation(encryptedMessage);
    const ciphertextAtRest = await this.secureMsg.encryptForAtRest(messageId, content.text);
    // Order by the sender's send time so every device agrees, and so a delayed message keeps its
    // real position instead of jumping to the bottom. Only clamp the future: a bad/lying clock may
    // not push a message more than MAX_CLOCK_SKEW past our arrival time. A late (past) send time is
    // legitimate (network delay) and kept as-is.
    const receivedAt = Date.now();
    const createdAt = ts != null
      ? Math.min(ts, receivedAt + MessagesService.MAX_CLOCK_SKEW)
      : receivedAt;
    await this.saveIncomingMessage(
      encryptedMessage, conversationId, ciphertextAtRest, content.type, createdAt, ts, receivedAt
    );
    await this.conversationsService.updateLastMessage(
      conversationId, messagePreview(content.type, content.text), createdAt
    );
    await this.conversationsService.adjustUnreadCount(conversationId, 1);
    if (notify) {
      await this.notifyIfBackground(encryptedMessage, conversationId, content);
    }
    return { messageId, senderId, type: ReceiptType.Delivered };
  }

  /**
   * Raise a local OS notification when a message lands while the app is backgrounded but still
   * connected to the Hub. The server only sends web-push while a client is disconnected, so this
   * covers the connected-but-hidden gap. Silent when the app is visible.
   */
  private async notifyIfBackground(
    encryptedMessage: EncryptedMessage | any, conversationId: string, content: MessageContent
  ): Promise<void> {
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      return;
    }
    const { senderId, groupId } = encryptedMessage;
    const view = await this.conversationsService.getConversationView(conversationId);
    if (!view) {
      return;
    }
    const preview = messagePreview(content.type, content.text);
    let body = preview;
    if (groupId) {
      const sender = await this.usersService.getProfile(senderId);
      const senderName = sender?.localName || sender?.username || 'Someone';
      body = `${senderName}: ${preview}`;
    }
    await this.pushService.showLocalNotification(
      view.title, body, { senderId, groupId }, view.avatarUrl
    );
  }

  /**
   * Find (or lazily create) the local conversation an incoming message belongs to.
   */
  private resolveIncomingConversation(encryptedMessage: EncryptedMessage | any): Promise<string> {
    const { groupId, senderId } = encryptedMessage;
    return groupId
      ? this.conversationsService.ensureGroupConversation(groupId)
      : this.conversationsService.ensureDirectConversation(senderId);
  }

  /**
   * Re-send the receipt for a message we already have when the server redelivers it
   */
  private async reacknowledgeStored(messageId: string, senderId: string): Promise<PendingReceipt> {
    const stored = await this.repository.getMessageById(messageId);
    const type = stored?.status === 'read' ? ReceiptType.Read : ReceiptType.Delivered;
    return { messageId, senderId, type };
  }

  /** Sign a receipt of the given type for a received message. */
  private async signedReceipt(messageId: string, senderId: string, type: ReceiptType)
    : Promise<DeliveryReceipt> {
    const signature = await this.secureMsg.signReceipt(messageId, type, senderId);
    return { messageId, originalSenderId: senderId, type, signature };
  }

  /**
   * Sign a batch of pending receipts and acknowledge them in a single request. Per-receipt signing
   * failures are logged and skipped; a failed network send is logged, never thrown.
   */
  private async flushReceipts(pending: PendingReceipt[]): Promise<void> {
    if (pending.length === 0) {
      return;
    }
    const receipts: DeliveryReceipt[] = [];
    for (const { messageId, senderId, type } of pending) {
      try {
        receipts.push(await this.signedReceipt(messageId, senderId, type));
      } catch (e) {
        console.warn('Could not sign receipt', messageId, e);
      }
    }
    if (receipts.length === 0) {
      return;
    }
    try {
      await lastValueFrom(this.messagesApi.sendReceiptsBatch(receipts));
    } catch (err) {
      console.error('Failed to send receipts:', err);
    }
  }

  /**
   * Stop handling incoming messages and disconnect from the Hub. Called on logout.
   */
  stopListening(): void {
    this.incomingSubscription?.unsubscribe();
    this.incomingSubscription = undefined;

    this.deliveredSubscription?.unsubscribe();
    this.deliveredSubscription = undefined;

    this.readSubscription?.unsubscribe();
    this.readSubscription = undefined;

    this.undecryptableSubscription?.unsubscribe();
    this.undecryptableSubscription = undefined;

    this.keyChangedSubscription?.unsubscribe();
    this.keyChangedSubscription = undefined;

    this.connectedSubscription?.unsubscribe();
    this.connectedSubscription = undefined;

    this.hubService.disconnect();
    this.secureMsg.clearMemory();
  }

  /**
   * Observe messages for a specific conversation to populate the chat view
   */
  observeMessages(conversationId: string): Observable<LocalMessage[]> {
    return this.repository.observeMessagesByConversation(conversationId);
  }

  /**
   * Drop an identity-changed notice into the direct conversation with a contact and into every
   * group they share with us. All conversation lookups are local reads — no server roster fetch.
   */
  private async insertIdentityChangedNotice(userId: string): Promise<void> {
    const directId = await this.conversationsService.findDirectConversationId(userId);
    const groupIds = await this.conversationsService.findGroupConversationIdsWithMember(userId);
    const conversationIds = directId ? [directId, ...groupIds] : groupIds;
    for (const conversationId of conversationIds) {
      await this.repository.addMessage(this.identityChangedNotice(conversationId, userId));
    }
  }

  private identityChangedNotice(conversationId: string, userId: string): SystemMessage {
    const now = Date.now();
    return {
      kind: 'system',
      id: `sys-identity-${conversationId}-${userId}-${now}`,
      conversationId,
      senderId: userId,
      text: '',
      isMine: false,
      createdAt: now,
      systemType: 'identity-changed',
    };
  }


  /**
   * Get all messages for a specific conversation
   */
  async getMessages(conversationId: string): Promise<LocalMessage[]> {
    return this.repository.getMessagesByConversation(conversationId);
  }

  async sendMessage(
    conversationId: string,
    text: string,
    contentType: MessageContentType = 'text'
  ): Promise<void> {
    return this.outboxService.sendMessage(conversationId, text, contentType);
  }

  /**
   * Mark one or more received messages as read: update them locally, drop the conversation's unread
   * count in one step, and acknowledge them to their senders with a single batched request (opening
   * a chat with N unread sends one round-trip, not N).
   */
  async markManyAsRead(messages: LocalMessage[]): Promise<void> {
    const unread = messages.filter(m => !m.isMine && m.status !== 'read');
    if (unread.length === 0) {
      return;
    }

    // Local: flip to read and decrement the unread count per conversation in one write each.
    for (const m of unread) {
      m.status = 'read';
    }
    await this.repository.saveMessages(unread)
      .catch(err => console.error('Failed to update local messages as read', err));

    const perConversation = new Map<string, number>();
    for (const m of unread) {
      perConversation.set(m.conversationId, (perConversation.get(m.conversationId) ?? 0) + 1);
    }
    for (const [conversationId, count] of perConversation) {
      await this.conversationsService.adjustUnreadCount(conversationId, -count);
    }

    // Network: one batch of individually-signed read receipts.
    const receipts: DeliveryReceipt[] = [];
    for (const m of unread) {
      try {
        receipts.push(await this.signedReceipt(m.id, m.senderId, ReceiptType.Read));
      } catch (e) {
        console.warn('Could not sign read receipt', m.id, e);
      }
    }
    if (receipts.length === 0) {
      return;
    }
    try {
      await lastValueFrom(this.messagesApi.sendReceiptsBatch(receipts));
    } catch (err) {
      console.error('Failed to send read receipts:', err);
    }
  }

  /**
   * Persist an incoming message to the local store. {@code recipientId} is carried for 1:1
   * messages, while {@code groupId} marks (and identifies) group messages.
   */
  private async saveIncomingMessage(
    encryptedMessage: EncryptedMessage | any,
    conversationId: string,
    atRestText: string,
    contentType: MessageContentType,
    createdAt: number,
    sentAt: number | undefined,
    receivedAt: number
  ): Promise<LocalMessage> {
    const base = {
      id: encryptedMessage.messageId, // Real external message id
      conversationId,
      senderId: encryptedMessage.senderId,
      text: atRestText,
      contentType,
      isMine: false,
      createdAt,
      sentAt,
      receivedAt
    };
    const message: LocalMessage = encryptedMessage.groupId
      ? { ...base, kind: 'group', groupId: encryptedMessage.groupId }
      : { ...base, kind: 'direct', recipientId: encryptedMessage.recipientId };

    await this.repository.addMessage(message);
    return message;
  }

  async decryptFromAtRest(messageId: string, ciphertext: string): Promise<string> {
    return this.secureMsg.decryptFromAtRest(messageId, ciphertext);
  }
}

