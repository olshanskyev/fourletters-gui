import { Injectable, inject } from '@angular/core';
import { MessagesRepository } from './messages.repository';
import { LocalMessage } from './models/messages.model';
import { Observable, Subscription } from 'rxjs';
import { ConversationsService } from '../conversations/conversations.service';
import { HubService } from './ws/hub.service';
import { MessagesApiService } from './messages-api.service';
import { SettingsService } from '../shared/settings.service';
import { OutboxService } from './outbox.service';
import { ReceiptType } from '../../dto/receiptType';

@Injectable({
  providedIn: 'root'
})
export class MessagesService {
  private repository = inject(MessagesRepository);
  private conversationsService = inject(ConversationsService);
  private hubService = inject(HubService);
  private messagesApi = inject(MessagesApiService);
  private settingsService = inject(SettingsService);
  private outboxService = inject(OutboxService);

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

    // Sync inbox at startup
    this.messagesApi.fetchInbox().subscribe({
      next: async (res) => {
        if (res.serverStartedAt) {
          this.settingsService.setOptions({ serverStartedAt: res.serverStartedAt });
        }

        // Save unread messages from inbox
        for (const encryptedMessage of res.messages || []) {
          await this.processIncomingMessage(encryptedMessage);
        }

        // Process receipts for messages we sent that were delivered/read while we were offline
        for (const receipt of res.receipts || []) {
          await this.outboxService.processReceipt(receipt.messageId, receipt.type as 'delivered' | 'read');
        }

        // Retry undelivered messages if server restarted
        this.outboxService.resync();
      },
      error: (err) => console.error('Failed to sync inbox:', err)
    });

    this.incomingSubscription = this.hubService.messages.subscribe(async (encryptedMessage) => {
      await this.processIncomingMessage(encryptedMessage);
    });

    this.deliveredSubscription = this.hubService.messageDelivered.subscribe(async (receipt) => {
      await this.outboxService.processReceipt(receipt.messageId, 'delivered');
    });

    this.readSubscription = this.hubService.messageRead.subscribe(async (receipt) => {
      await this.outboxService.processReceipt(receipt.messageId, 'read');
    });
  }

  private async processIncomingMessage(encryptedMessage: any) {
    const conversationId = encryptedMessage.senderId;

    if (!conversationId) {
      console.warn('Received encrypted message without a senderId. Dropping message.', encryptedMessage);
      return;
    }

    // De-duplicate: Ensure we don't save the same message again when unioning Hot and Cold tiers
    const existing = await this.repository.hasMessage(encryptedMessage.messageId);
    if (existing) {
      return;
    }

    const text = encryptedMessage.payload;

    await this.saveIncomingMessage(conversationId, encryptedMessage.senderId, text, false, encryptedMessage.messageId);

    // Confirm delivery to the Server with a signed receipt
    this.messagesApi.sendReceipt(encryptedMessage.messageId, encryptedMessage.senderId).subscribe({
      error: (err) => console.error('Failed to send delivery receipt:', err)
    });
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
    await this.repository.updateMessage(message).catch(err => console.error('Failed to update local message as read', err));

    this.messagesApi.sendReceipt(message.id, message.senderId, ReceiptType.Read).subscribe({
      error: (err) => console.error('Failed to send read receipt:', err)
    });
  }

  /**
   * Save an incoming message to the database
   */
  private async saveIncomingMessage(
    conversationId: string,
    senderId: string,
    text: string,
    isMine: boolean,
    externalMessageId: string)
  : Promise<LocalMessage> {
    // If the conversation doesn't exist yet, we create it dynamically.
    // Name is 'Unknown' by default, fetch alias/name in the future.
    await this.conversationsService.createOrUpdateConversation(conversationId, 'Unknown Contact');

    const time = Date.now();
    const message: LocalMessage = {
      id: externalMessageId, // Real external message id
      conversationId,
      senderId,
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
