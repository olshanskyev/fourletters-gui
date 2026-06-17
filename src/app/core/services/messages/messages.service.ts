import { Injectable, inject } from '@angular/core';
import { MessagesRepository } from './messages.repository';
import { LocalMessage } from './models/messages.model';
import { Observable, Subscription } from 'rxjs';
import { ConversationsService } from '../conversations/conversations.service';
import { HubService } from '../ws/hub.service';
import { MessagesApiService } from './messages-api.service';

@Injectable({
  providedIn: 'root'
})
export class MessagesService {
  private repository = inject(MessagesRepository);
  private conversationsService = inject(ConversationsService);
  private hubService = inject(HubService);
  private messagesApi = inject(MessagesApiService);

  private incomingSubscription?: Subscription;

  /**
   * Connect to the Hub and start handling incoming live messages. Idempotent.
   * Called once by startup service when the user is authenticated.
   */
  startListening(): void {
    if (this.incomingSubscription) {
      return;
    }

    this.hubService.connect();

    this.incomingSubscription = this.hubService.messages.subscribe(async (encryptedMessage) => {

      // at the moment partner is the sender.
      const conversationId = encryptedMessage.senderId;

      if (!conversationId) {
        console.warn('Received encrypted message without a senderId. Dropping message.', encryptedMessage);
        return;
      }

      const text = encryptedMessage.payload;

      await this.saveIncomingMessage(conversationId, text, false, encryptedMessage.messageId);

      // Confirm delivery to the Server with a signed receipt
      this.messagesApi.sendReceipt(encryptedMessage.messageId).subscribe({
        error: (err) => console.error('Failed to send delivery receipt:', err)
      });
    });
  }

  /**
   * Stop handling incoming messages and disconnect from the Hub. Called on logout.
   */
  stopListening(): void {
    this.incomingSubscription?.unsubscribe();
    this.incomingSubscription = undefined;
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

  /**
   * Save a message to the database and update the conversation's last message metadata
   */
  async saveMessage(
    conversationId: string,
    text: string, isMine: boolean,
    id: string = crypto.randomUUID())
  : Promise<LocalMessage> {
    const time = Date.now();
    const message: LocalMessage = {
      id,
      conversationId,
      text,
      isMine,
      createdAt: time
    };

    // Save message to DB
    await this.repository.addMessage(message);

    // Automatically update the conversation's "lastMessage" and time metadata
    await this.conversationsService.updateLastMessage(conversationId, text, time);

    return message;
  }

  /**
   * Save an incoming message to the database
   */
  private async saveIncomingMessage(
    conversationId: string,
    text: string, isMine: boolean,
    externalMessageId: string)
  : Promise<LocalMessage> {
    // If the conversation doesn't exist yet, we create it dynamically.
    // Name is 'Unknown' by default, fetch alias/name in the future.
    await this.conversationsService.createOrUpdateConversation(conversationId, 'Unknown Contact');

    const time = Date.now();
    const message: LocalMessage = {
      id: externalMessageId, // Real external message id
      conversationId,
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
