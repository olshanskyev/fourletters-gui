import { Injectable, inject } from '@angular/core';
import { MessagesRepository } from './messages.repository';
import { LocalMessage } from './models/messages.model';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesApiService } from './messages-api.service';
import { AppDatabase } from '../database/app.database';
import { SecureMessageService } from './secure-message.service';
import { lastValueFrom } from 'rxjs';
import { ConversationType, LocalConversation } from '../..';

@Injectable({
  providedIn: 'root'
})
export class OutboxService {
  private repository = inject(MessagesRepository);
  private conversationsService = inject(ConversationsService);
  private messagesApi = inject(MessagesApiService);
  private appDb = inject(AppDatabase);
  private secureMsg = inject(SecureMessageService);

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
    const currentServerStartedAt = await this.appDb.getMeta<number>('serverStartedAt');
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

      // Group into chunks of 50 to avoid oversized payloads
      const chunkSize = 50;
      for (let i = 0; i < messagesToResend.length; i += chunkSize) {
        const chunk = messagesToResend.slice(i, i + chunkSize);

        const payloadPromises = chunk.map(async msg => {
          // Recover plaintext from at-rest encrypted message
          const plaintext = await this.secureMsg.decryptFromAtRest(msg.id, msg.text);
          const targetRecipientId = msg.recipientId || msg.conversationId;
          const {
            payload,
            signature
          } = await this.secureMsg.buildOutgoingPayload(targetRecipientId, plaintext);

          return {
            messageId: msg.id,
            recipientId: targetRecipientId,
            payload,
            signature
          };
        });

        const payload = await Promise.all(payloadPromises);

        try {
          const res = await lastValueFrom(this.messagesApi.sendMessagesBatch(payload));

          if (res.serverStartedAt) {
            await this.appDb.setMeta('serverStartedAt', res.serverStartedAt);
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
        } catch (err) {
          console.error('Failed to resubmit batched messages:', err);
        }
      }

    } catch (err) {
      console.error('Failed to resync outbox:', err);
    }
  }

  getReceipient(conversation: LocalConversation): string | undefined {
    return (conversation?.type === 'direct')?
       conversation.participants?.[0] :
       conversation?.groupId
  }

  async sendMessage(
    conversationId: string,
    text: string ): Promise<void> {

    const convo = await this.conversationsService.getConversation(conversationId);
    if (!convo) {
      console.error('Conversation not found. Message sending failed.', conversationId);
      return Promise.resolve();
    }

    const recipientId = this.getReceipient(convo);

    if (!recipientId) {
      console.error('No recipient found for conversation. Message sending failed.', conversationId);
      return Promise.resolve();
    }

    const id = crypto.randomUUID();
    const time = Date.now();

    // 1. Encrypt for local At-Rest Storage
    const atRestCiphertext = await this.secureMsg.encryptForAtRest(id, text);

    // 2. Encrypt & Sign for E2E Transmission
    const { payload, signature } = await this.secureMsg.buildOutgoingPayload(recipientId, text);

    const message: LocalMessage = {
      id,
      conversationId,
      senderId: 'me', // Placeholder, real senderId the server calculates based on auth
      recipientId,
      text: atRestCiphertext,
      isMine: true,
      createdAt: time,
      status: 'pending',
      retryCount: 0
    };

    // Save message to DB (outbox)
    await this.repository.addMessage(message);
    await this.conversationsService.updateLastMessage(conversationId, text, time);

    // Call API and await result
    try {
      const res = await lastValueFrom(
        this.messagesApi.sendMessage(recipientId, payload, signature, id, convo.type)
      );

      const msgToUpdate = await this.repository.getMessageById(id);
      if (msgToUpdate) {
        msgToUpdate.status = 'accepted';
        if (res.serverStartedAt) {
          msgToUpdate.serverStartedAt = res.serverStartedAt;
          await this.appDb.setMeta('serverStartedAt', res.serverStartedAt);
        }
        await this.repository.updateMessage(msgToUpdate).catch(err => console.error('Failed to update message metadata', err));
      }
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  }
}
