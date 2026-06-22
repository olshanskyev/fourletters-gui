import { Injectable, inject } from '@angular/core';
import { MessagesRepository } from './messages.repository';
import { LocalMessage } from './models/messages.model';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { MessagesApiService } from './messages-api.service';
import { SyncStateRepository } from './sync-state.repository';
import { SecureMessageService } from './secure-message.service';
import { lastValueFrom, Observable } from 'rxjs';
import { LocalConversation } from '@core/services/conversations/models/conversations.model';
import { AcceptedResponse } from '@dto/models';

/** A built outgoing message ready to transmit: the optional 1:1 recipient or group, and a bound send call. */
interface PreparedSend {
  recipientId?: string;
  groupId?: string;
  send: () => Observable<AcceptedResponse>;
}

@Injectable({
  providedIn: 'root'
})
export class OutboxService {
  private repository = inject(MessagesRepository);
  private conversationsService = inject(ConversationsService);
  private messagesApi = inject(MessagesApiService);
  private syncState = inject(SyncStateRepository);
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
    const currentServerStartedAt = await this.syncState.getServerStartedAt();
    if (!currentServerStartedAt) return;

    try {
      const pendingMessages = await this.repository.getUnconfirmedMessages();
      const messagesToResend: LocalMessage[] = [];

      for (const msg of pendingMessages) {
        if ((msg.retryCount || 0) > 0) continue;
        // ToDo: group message resync needs epoch-key rebuild; skip group messages for now
        if (msg.groupId) continue;
        if (!msg.recipientId) continue; // direct messages always carry a recipient

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
          const recipientId = msg.recipientId!;
          const {
            payload,
            signature
          } = await this.secureMsg.buildOutgoingPayload(recipientId, plaintext);

          return {
            messageId: msg.id,
            recipientId,
            payload,
            signature
          };
        });

        const payload = await Promise.all(payloadPromises);

        try {
          const res = await lastValueFrom(this.messagesApi.sendMessagesBatch(payload));

          if (res.serverStartedAt) {
            await this.syncState.setServerStartedAt(res.serverStartedAt);
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
       conversation?.groupId;
  }

  async sendMessage(
    conversationId: string,
    text: string ): Promise<void> {

    const convo = await this.conversationsService.getConversation(conversationId);
    if (!convo) {
      console.error('Conversation not found. Message sending failed.', conversationId);
      return;
    }

    const id = crypto.randomUUID();
    const time = Date.now();

    // 1. Build the transmission payload (direct vs group differ only here)
    const prepared = (convo.type === 'group')
      ? await this.prepareGroupSend(convo, text, id)
      : await this.prepareDirectSend(convo, text, id);
    if (!prepared) {
      return; // target resolution failed and was already logged
    }

    // 2. Encrypt for local At-Rest Storage and persist to the outbox
    const message: LocalMessage = {
      id,
      conversationId: convo.id,
      senderId: 'me', // Placeholder, real senderId the server calculates based on auth
      recipientId: prepared.recipientId,
      groupId: prepared.groupId,
      text: await this.secureMsg.encryptForAtRest(id, text),
      isMine: true,
      createdAt: time,
      status: 'pending',
      retryCount: 0
    };
    await this.persistOutgoing(message, text, time);

    // 3. Send and reconcile acceptance
    try {
      const res = await lastValueFrom(prepared.send());
      await this.confirmAccepted(id, res);
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  }

  /**
   * Resolve a 1:1 send: E2E-encrypt and sign for the single recipient and bind the API call.
   */
  private async prepareDirectSend(
    convo: LocalConversation,
    text: string,
    id: string
  ): Promise<PreparedSend | undefined> {
    const recipientId = this.getReceipient(convo);
    if (!recipientId) {
      console.error('No recipient found for conversation. Message sending failed.', convo.id);
      return undefined;
    }

    const { payload, signature } = await this.secureMsg.buildOutgoingPayload(recipientId, text);
    return {
      recipientId,
      send: () => this.messagesApi.sendMessage(recipientId, payload, signature, id)
    };
  }

  /**
   * Resolve a group send: encrypt once under the current epoch's sender-key, sign, and bind the
   * single fan-out API call.
   */
  private async prepareGroupSend(
    convo: LocalConversation,
    text: string,
    id: string
  ): Promise<PreparedSend | undefined> {
    const groupId = convo.groupId;
    if (!groupId) {
      console.error('Group conversation missing groupId. Message sending failed.', convo.id);
      return undefined;
    }

    const { payload, signature, epoch } = await this.secureMsg.buildOutgoingGroupPayload(groupId, text);
    return {
      groupId,
      send: () => this.messagesApi.sendGroupMessage(groupId, epoch, payload, signature, id)
    };
  }

  /**
   * Persist a freshly built outgoing message to the local outbox and refresh the conversation
   * preview with its plaintext.
   */
  private async persistOutgoing(message: LocalMessage, previewText: string, time: number): Promise<void> {
    await this.repository.addMessage(message);
    await this.conversationsService.updateLastMessage(message.conversationId, previewText, time);
  }

  /**
   * Mark a sent message as accepted by the Server and reconcile the server-start watermark.
   */
  private async confirmAccepted(id: string, res: AcceptedResponse): Promise<void> {
    const msgToUpdate = await this.repository.getMessageById(id);
    if (!msgToUpdate) {
      return;
    }

    msgToUpdate.status = 'accepted';
    if (res.serverStartedAt) {
      msgToUpdate.serverStartedAt = res.serverStartedAt;
      await this.syncState.setServerStartedAt(res.serverStartedAt);
    }
    await this.repository.updateMessage(msgToUpdate)
      .catch(err => console.error('Failed to update message metadata', err));
  }
}
