import { Injectable, inject } from '@angular/core';
import { MessagesRepository } from './messages.repository';
import { LocalMessage } from './models/messages.model';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesApiService } from './messages-api.service';
import { SettingsService } from '../shared/settings.service';

@Injectable({
  providedIn: 'root'
})
export class OutboxService {
  private repository = inject(MessagesRepository);
  private conversationsService = inject(ConversationsService);
  private messagesApi = inject(MessagesApiService);
  private settingsService = inject(SettingsService);

  async processReceipt(messageId: string, status: 'delivered' | 'read') {
    try {
      const msg = await this.repository.getMessageById(messageId);
      if (msg) {
        // Only upgrade status (pending -> delivered -> read)
        if (msg.status === 'read' || (msg.status === 'delivered' && status === 'delivered')) {
          return;
        }
        msg.status = status;
        await this.repository.updateMessage(msg);
      }
    } catch (err) {
      console.error('Failed to update message state from receipt:', err);
    }
  }

  async resync(): Promise<void> {
    const currentServerStartedAt = this.settingsService.options().serverStartedAt;
    if (!currentServerStartedAt) return;

    try {
      const pendingMessages = await this.repository.getUnconfirmedMessages();
      const messagesToResend: LocalMessage[] = [];

      for (const msg of pendingMessages) {
        if ((msg.retryCount || 0) > 0) continue;

        let shouldResend = false;
        if (msg.status === 'pending') {
          shouldResend = true;
        } else if (msg.status === 'accepted' && msg.serverStartedAt !== currentServerStartedAt) {
          shouldResend = true;
        }

        if (shouldResend) {
          msg.retryCount = 1;
          await this.repository.updateMessage(msg);
          messagesToResend.push(msg);
        }
      }

      if (messagesToResend.length === 0) return;

      // Group into chunks of 50 to avoid oversized payloads
      const chunkSize = 50;
      for (let i = 0; i < messagesToResend.length; i += chunkSize) {
        const chunk = messagesToResend.slice(i, i + chunkSize);

        const payload = chunk.map(msg => ({
          messageId: msg.id,
          recipientId: msg.conversationId,
          payload: msg.text,
          signature: '' // placeholder until E2E signing is implemented
        }));

        this.messagesApi.sendMessagesBatch(payload).subscribe({
          next: async (res) => {
            if (res.serverStartedAt) {
              this.settingsService.setOptions({ serverStartedAt: res.serverStartedAt });
            }

            // Update accepted status for each message according to the results
            for (const acceptedRes of res.results || []) {
              const localMsg = chunk.find(m => m.id === acceptedRes.messageId);
              if (localMsg) {
                localMsg.status = 'accepted';
                localMsg.serverStartedAt = res.serverStartedAt;
                await this.repository.updateMessage(localMsg).catch(err => console.error('Failed to update message metadata', err));
              }
            }
          },
          error: (err) => console.error('Failed to resubmit batched messages:', err)
        });
      }

    } catch (err) {
      console.error('Failed to resync outbox:', err);
    }
  }

  async sendMessage(conversationId: string, text: string): Promise<void> {
    const id = crypto.randomUUID();
    const time = Date.now();
    const message: LocalMessage = {
      id,
      conversationId,
      senderId: 'me', // Placeholder, real senderId the server calculates based on auth
      text,
      isMine: true,
      createdAt: time,
      status: 'pending',
      retryCount: 0
    };

    // Save message to DB (outbox)
    await this.repository.addMessage(message);
    await this.conversationsService.updateLastMessage(conversationId, text, time);

    // Call API and subscribe
    this.messagesApi.sendMessage(conversationId, text, id).subscribe({
      next: (res) => {
        message.status = 'accepted';
        if (res.serverStartedAt) {
          message.serverStartedAt = res.serverStartedAt;
        }
        this.repository.updateMessage(message).catch(err => console.error('Failed to update message metadata', err));
      },
      error: (err) => console.error('Failed to send message:', err)
    });
  }
}
