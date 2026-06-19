import { Injectable, inject } from '@angular/core';
import { MessagesRepository } from './messages.repository';
import { LocalMessage } from './models/messages.model';
import { Observable, Subscription, lastValueFrom, concatMap } from 'rxjs';
import { ConversationsService } from '../conversations/conversations.service';
import { HubService } from './ws/hub.service';
import { MessagesApiService } from './messages-api.service';
import { OutboxService } from './outbox.service';
import { ReceiptType } from '../../dto/receiptType';
import { AppDatabase } from '../database/app.database';
import { SecureMessageService } from './secure-message.service';
import { EncryptedMessage } from '../../dto/encryptedMessage';
import { ReceiptData } from '../../dto/models';

@Injectable({
  providedIn: 'root'
})
export class MessagesService {
  private repository = inject(MessagesRepository);
  private conversationsService = inject(ConversationsService);
  private hubService = inject(HubService);
  private messagesApi = inject(MessagesApiService);
  private outboxService = inject(OutboxService);
  private appDb = inject(AppDatabase);
  private secureMsg = inject(SecureMessageService);

  private incomingSubscription?: Subscription;
  private deliveredSubscription?: Subscription;
  private readSubscription?: Subscription;

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

    // async initialization
    (async () => {
      try {
        // Sync inbox at startup
        const res = await lastValueFrom(this.messagesApi.fetchInbox());
        if (res.serverStartedAt) {
          await this.appDb.setMeta('serverStartedAt', res.serverStartedAt);
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

    try {
      // 1. Unpack E2E Payload (Verify Signature & Decrypt ECDH->AES)
      const plaintext = await this.secureMsg.unpackIncomingPayload(
        encryptedMessage.senderId,
        encryptedMessage.payload,
        encryptedMessage.signature
      );

      // 2. Encrypt for Local IndexedDB storage (AES Master Key)
      const ciphertextAtRest = await this.secureMsg.encryptForAtRest(
        encryptedMessage.messageId,
        plaintext
      );

      const localMessage = await this.saveIncomingMessage(
        encryptedMessage.senderId,
        encryptedMessage.recipientId,
        ciphertextAtRest,
        false,
        encryptedMessage.messageId
      );

      // Update preview to plaintext
      await this.conversationsService.updateLastMessage(
        localMessage.conversationId,
        plaintext,
        Date.now()
      );

      // 3. Confirm delivery dynamically signing the receipt
      const receiptSignature = await this.secureMsg.signReceipt(
        encryptedMessage.messageId, ReceiptType.Delivered, encryptedMessage.senderId
      );

      try {
        await lastValueFrom(
          this.messagesApi.sendReceipt(
            encryptedMessage.messageId,
            encryptedMessage.senderId,
            receiptSignature
          )
        );
      } catch (err) {
        console.error('Failed to send delivery receipt:', err);
      }

    } catch (err) {
      console.warn('E2E validation or decryption failed for message', encryptedMessage.messageId, err);
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
    const convo = await this.conversationsService.getConversation(conversationId);
    if (!convo || convo.type === 'direct') {
      // If conversation is not found yet, default to direct
      const recipientId = (convo && convo.participants?.length > 0)
        ? convo.participants[0]
        : conversationId;
      return this.outboxService.sendMessage(conversationId, recipientId, text);
    } else {
      console.warn('Group message sending is not implemented yet. Placeholder activated.');
      // Placeholder for group send logic
      return Promise.resolve();
    }
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
   * Save an incoming message to the database
   */
  private async saveIncomingMessage(
    senderId: string,
    recipientId: string,
    text: string,
    isMine: boolean,
    externalMessageId: string)
  : Promise<LocalMessage> {
    // Find if we already have a conversation with this person
    let conversationId: string;
    // currently only direct conversations are supported
    const existingConvo = await this.conversationsService.getDirectConversationWith(senderId);

    if (existingConvo) {
      conversationId = existingConvo.id;
    } else {
      // Create a brand new UUID for this incoming conversation
      const newConvo = await this.conversationsService.createConversation(
        'Unknown Contact',
        'direct',
        [senderId]
      );
      conversationId = newConvo.id;
    }

    const time = Date.now();
    const message: LocalMessage = {
      id: externalMessageId, // Real external message id
      conversationId,
      senderId,
      recipientId,
      text,
      isMine,
      createdAt: time
    };

    // Save to DB
    await this.repository.addMessage(message);

    // Refresh conversation latest info
    await this.conversationsService.updateLastMessage(conversationId, text, time);

    return message;
  }
}
