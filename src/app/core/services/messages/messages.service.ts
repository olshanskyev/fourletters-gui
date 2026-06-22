import { Injectable, inject } from '@angular/core';
import { MessagesRepository } from './messages.repository';
import { LocalMessage } from './models/messages.model';
import { Observable, Subscription, lastValueFrom, concatMap } from 'rxjs';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { HubService } from './ws/hub.service';
import { MessagesApiService } from './messages-api.service';
import { OutboxService } from './outbox.service';
import { ReceiptType, EncryptedMessage, ReceiptData } from '@dto/models';
import { SyncStateRepository } from './sync-state.repository';
import { SecureMessageService } from './secure-message.service';
import { GroupsService } from '@core/services/groups/groups.service';

@Injectable({
  providedIn: 'root'
})
export class MessagesService {
  private repository = inject(MessagesRepository);
  private conversationsService = inject(ConversationsService);
  private hubService = inject(HubService);
  private messagesApi = inject(MessagesApiService);
  private outboxService = inject(OutboxService);
  private syncState = inject(SyncStateRepository);
  private secureMsg = inject(SecureMessageService);
  private groupsService = inject(GroupsService);

  private incomingSubscription?: Subscription;
  private deliveredSubscription?: Subscription;
  private readSubscription?: Subscription;
  private groupKeyRotatedSubscription?: Subscription;

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
        await this.processIncomingMessage(encryptedMessage);
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

    this.groupKeyRotatedSubscription = this.hubService.groupKeyRotated.pipe(
      concatMap(async (notification) => {
        try {
          await this.groupsService.onGroupKeyRotated(notification);
        } catch (err) {
          console.error('Failed to handle group key rotation nudge:', err);
        }
      })
    ).subscribe();

    // async initialization
    (async () => {
      try {
        // Sync inbox at startup
        const res = await lastValueFrom(this.messagesApi.fetchInbox());
        if (res.serverStartedAt) {
          await this.syncState.setServerStartedAt(res.serverStartedAt);
        }

        // Unseal any group keys distributed while we were offline before draining messages
        if (res.groupKeys?.length) {
          await this.groupsService.handleIncomingGroupKeys(res.groupKeys);
        }

        // Save unread messages from inbox
        for (const encryptedMessage of res.messages || []) {
          await this.processIncomingMessage(encryptedMessage);
        }

        // Process receipts for messages we sent that were delivered/read while we were offline
        for (const receipt of res.receipts || []) {
          if (await this.checkReceiptSignature(receipt)) {
            await this.outboxService.processReceipt(receipt.messageId, receipt.type as 'delivered' | 'read');
          } else {
             console.warn('Invalid receipt signature dropped', receipt);
          }
        }
      } catch (err) {
        console.error('Failed to sync inbox:', err);
      }

      try {
        // Retry undelivered messages if server restarted
        this.outboxService.resync();
      } catch (err) {
        console.error('Failed to resync outbox messages after startup:', err);
      }
    })();

  }

  private async checkReceiptSignature(receipt: ReceiptData): Promise<boolean> {
    return await this.secureMsg.verifyReceipt(
        receipt.messageId, receipt.type, receipt.recipientId, receipt.signature
    );
  }

  private async processIncomingMessage(encryptedMessage: EncryptedMessage | any) {
    if (!encryptedMessage.senderId) {
      console.warn('Received encrypted message without a senderId. Dropping message.', encryptedMessage);
      return;
    }

    // De-duplicate: Ensure we don't save the same message again when unioning Hot and Cold tiers
    const existing = await this.repository.hasMessage(encryptedMessage.messageId);
    if (existing) {
      return;
    }

    const { senderId, messageId } = encryptedMessage;

    try {
      // 1. Verify the sender's signature and decrypt (group key recovered from Server if missing)
      const plaintext = await this.decryptIncoming(encryptedMessage);

      // 2. Resolve the target conversation (direct or group), creating it if unknown
      const conversationId = await this.resolveIncomingConversation(encryptedMessage);

      // 3. Re-encrypt at-rest and persist locally
      const ciphertextAtRest = await this.secureMsg.encryptForAtRest(messageId, plaintext);
      await this.saveIncomingMessage(encryptedMessage, conversationId, ciphertextAtRest);

      // 4. Refresh the conversation preview with the plaintext
      await this.conversationsService.updateLastMessage(conversationId, plaintext, Date.now());

      // 5. Confirm delivery to the original sender
      await this.acknowledgeDelivery(messageId, senderId);
    } catch (err) {
      console.warn('Failed to process incoming message', messageId, err);
    }
  }

  /**
   * Verify and decrypt an incoming message, dispatching on whether it is a group or 1:1 payload.
   */
  private async decryptIncoming(encryptedMessage: EncryptedMessage | any): Promise<string> {
    const { groupId, epoch, senderId, payload, signature } = encryptedMessage;

    if (groupId) {
      return this.secureMsg.unpackIncomingGroupPayload(groupId, epoch, senderId, payload, signature);
    }
    return this.secureMsg.unpackIncomingPayload(senderId, payload, signature);
  }

  /**
   * Find (or lazily create) the local conversation an incoming message belongs to. Group messages
   */
  private async resolveIncomingConversation(encryptedMessage: EncryptedMessage | any): Promise<string> {
    const { groupId, senderId } = encryptedMessage;

    if (groupId) {
      const existing = await this.conversationsService.getGroupConversation(groupId);
      if (existing) {
        return existing.id;
      }
      // ToDo - fetch group metadata?
      const created = await this.conversationsService.createConversation('Group', 'group', [senderId], groupId);
      return created.id;
    }

    const existing = await this.conversationsService.getDirectConversationWith(senderId);
    if (existing) {
      return existing.id;
    }
    // ToDo - fetch contact info?
    const created = await this.conversationsService.createConversation('Unknown Contact', 'direct', [senderId]);
    return created.id;
  }

  /**
   * Sign and send a delivery receipt for a received message back to its original sender.
   */
  private async acknowledgeDelivery(messageId: string, senderId: string): Promise<void> {
    const receiptSignature = await this.secureMsg.signReceipt(
      messageId, ReceiptType.Delivered, senderId
    );

    try {
      await lastValueFrom(
        this.messagesApi.sendReceipt(messageId, senderId, receiptSignature)
      );
    } catch (err) {
      console.error('Failed to send delivery receipt:', err);
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

    this.groupKeyRotatedSubscription?.unsubscribe();
    this.groupKeyRotatedSubscription = undefined;

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
   * Get all messages for a specific conversation
   */
  async getMessages(conversationId: string): Promise<LocalMessage[]> {
    return this.repository.getMessagesByConversation(conversationId);
  }

  async sendMessage(conversationId: string, text: string): Promise<void> {
    return this.outboxService.sendMessage(conversationId, text);
  }

  /**
   * Mark a message as read in the local database and send a read receipt
   */
  async markAsRead(message: LocalMessage): Promise<void> {
    message.status = 'read';
    await this.repository.updateMessage(message)
      .catch(err => console.error('Failed to update local message as read', err));

    try {
      const receiptSignature = await this.secureMsg.signReceipt(
        message.id,
        ReceiptType.Read,
        message.senderId
      );

      try {
        await lastValueFrom(
          this.messagesApi.sendReceipt(
            message.id,
            message.senderId,
            receiptSignature,
            ReceiptType.Read
          )
        );
      } catch (err) {
        console.error('Failed to send read receipt:', err);
      }
    } catch (e) {
      console.warn('Could not sign read receipt', e);
    }
  }

  /**
   * Persist an incoming message to the local store. {@code recipientId} is carried for 1:1
   * messages, while {@code groupId} marks (and identifies) group messages.
   */
  private async saveIncomingMessage(
    encryptedMessage: EncryptedMessage | any,
    conversationId: string,
    atRestText: string
  ): Promise<LocalMessage> {
    const message: LocalMessage = {
      id: encryptedMessage.messageId, // Real external message id
      conversationId,
      senderId: encryptedMessage.senderId,
      recipientId: encryptedMessage.recipientId,
      groupId: encryptedMessage.groupId,
      text: atRestText,
      isMine: false,
      createdAt: Date.now()
    };

    await this.repository.addMessage(message);
    return message;
  }

  async decryptFromAtRest(messageId: string, ciphertext: string): Promise<string> {
    return this.secureMsg.decryptFromAtRest(messageId, ciphertext);
  }
}

