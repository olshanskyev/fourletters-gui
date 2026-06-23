import { Injectable, inject } from '@angular/core';
import { MessagesRepository } from './messages.repository';
import { LocalMessage } from './models/messages.model';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { MessagesApiService } from './messages-api.service';
import { SyncStateRepository } from './sync-state.repository';
import { SecureMessageService } from './secure-message.service';
import { GroupsService } from '@core/services/groups/groups.service';
import { AuthService } from '@core/services/authentication/auth.service';
import { lastValueFrom } from 'rxjs';
import { LocalConversation } from '@core/services/conversations/models/conversations.model';
import { AcceptedResponse } from '@dto/models';

/**
 * A built outgoing message ready to transmit: the optional 1:1 recipient or group, and a bound
 * send call. A group send fans the message out as one independent 1:1 copy per member.
 */
interface PreparedSend {
  recipientId?: string;
  groupId?: string;
  send: () => Promise<AcceptedResponse | undefined>;
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
  private groups = inject(GroupsService);
  private auth = inject(AuthService);

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

  /**
   * Resend a 1:1 message with already fetched new contact key.
   */
  async resendAfterKeyChange(messageId: string): Promise<void> {
    const msg = await this.repository.getMessageById(messageId);
    if (!msg || !msg.isMine) {
      return;
    }
    // Group copies are not re-keyed individually here; a member recovers on subsequent sends.
    if (msg.groupId || !msg.recipientId) {
      return;
    }
    if (msg.nackResent) {
      // Already retried once under a fresh key and still undecryptable: give up.
      await this.markFailed(msg);
      return;
    }

    try {
      // The recipient's current directory key was already re-pinned while verifying the receipt.
      const plaintext = await this.secureMsg.decryptFromAtRest(msg.id, msg.text);
      const { payload, signature } = await this.secureMsg.buildOutgoingPayload(msg.recipientId, plaintext);

      msg.nackResent = true;
      msg.status = 'pending';
      await this.repository.updateMessage(msg);

      const res = await lastValueFrom(
        this.messagesApi.sendMessage(msg.recipientId, payload, signature, msg.id)
      );
      await this.confirmAccepted(msg.id, res);
    } catch (err) {
      console.error('Failed to resend message after key change:', messageId, err);
      await this.markFailed(msg);
    }
  }

  /**
   * Manually re-send a message the user previously saw fail.
   */
  async resend(messageId: string): Promise<void> {
    const msg = await this.repository.getMessageById(messageId);
    if (!msg || !msg.isMine || msg.status !== 'failed') {
      return;
    }

    msg.status = 'pending';
    await this.repository.updateMessage(msg);

    try {
      const plaintext = await this.secureMsg.decryptFromAtRest(msg.id, msg.text);
      let res: AcceptedResponse | undefined;
      if (msg.groupId) {
        res = await this.fanOutGroup(msg.id, msg.groupId, plaintext);
      } else if (msg.recipientId) {
        const { payload, signature } = await this.secureMsg.buildOutgoingPayload(msg.recipientId, plaintext);
        res = await lastValueFrom(
          this.messagesApi.sendMessage(msg.recipientId, payload, signature, msg.id)
        );
      }
      if (res) {
        await this.confirmAccepted(msg.id, res);
      }
    } catch (err) {
      console.error('Failed to resend message:', messageId, err);
      await this.markFailed(msg);
    }
  }

  async resync(): Promise<void> {
    const currentServerStartedAt = await this.syncState.getServerStartedAt();
    if (!currentServerStartedAt) return;

    try {
      const pendingMessages = await this.repository.getUnconfirmedMessages();
      const { direct, group } = await this.collectResends(pendingMessages, currentServerStartedAt);

      // A group message is many 1:1 copies sharing one messageId; re-fan each to the current roster.
      for (const msg of group) {
        await this.resyncGroupMessage(msg);
      }

      // Direct messages go out in batches to avoid an oversized payload.
      const chunkSize = 50;
      for (let i = 0; i < direct.length; i += chunkSize) {
        await this.resendDirectBatch(direct.slice(i, i + chunkSize));
      }
    } catch (err) {
      console.error('Failed to resync outbox:', err);
    }
  }

  /**
   * Partition the unconfirmed outbox into the messages that need re-sending:
   * group messages to re-fan, and direct messages that were never accepted (their initial send
   * failed) or were accepted before a Server restart (re-pushed once, guarded by retryCount).
   */
  private async collectResends(
    pendingMessages: LocalMessage[],
    currentServerStartedAt: number
  ): Promise<{ direct: LocalMessage[]; group: LocalMessage[] }> {
    const direct: LocalMessage[] = [];
    const group: LocalMessage[] = [];

    for (const msg of pendingMessages) {
      if (msg.groupId) {
        group.push(msg);
      } else if (!msg.recipientId) {
        continue; // direct messages always carry a recipient
      } else if (msg.status === 'pending') {
        // Never accepted by the Server (the initial send failed): re-attempt once.
        direct.push(msg);
      } else if (
        msg.status === 'accepted' &&
        msg.serverStartedAt !== currentServerStartedAt &&
        !msg.retryCount
      ) {
        // Accepted, then the Server restarted before delivering it: re-push once.
        msg.retryCount = 1;
        await this.repository.updateMessage(msg);
        direct.push(msg);
      }
    }

    return { direct, group };
  }

  /**
   * Re-submit a batch of direct messages. Accepted copies move to 'accepted'; any never-accepted
   * message is marked 'failed'.
   */
  private async resendDirectBatch(chunk: LocalMessage[]): Promise<void> {
    const payload = await Promise.all(
      chunk.map(async msg => {
        const recipientId = msg.recipientId!;
        const plaintext = await this.secureMsg.decryptFromAtRest(msg.id, msg.text);
        const { payload, signature } = await this.secureMsg.buildOutgoingPayload(recipientId, plaintext);
        return { messageId: msg.id, recipientId, payload, signature };
      })
    );

    try {
      const res = await lastValueFrom(this.messagesApi.sendMessagesBatch(payload));
      if (res.serverStartedAt) {
        await this.syncState.setServerStartedAt(res.serverStartedAt);
      }

      const acceptedIds = new Set((res.results || []).map(r => r.messageId));
      for (const msg of chunk) {
        if (acceptedIds.has(msg.id)) {
          msg.status = 'accepted';
          msg.serverStartedAt = res.serverStartedAt;
          await this.repository.updateMessage(msg)
            .catch(err => console.error('Failed to update message metadata', err));
        } else if (msg.status === 'pending') {
          await this.markFailed(msg);
        }
      }
    } catch (err) {
      console.error('Failed to resubmit batched messages:', err);
      // The batch never reached the Server: fail the never-accepted ones for manual resend.
      for (const msg of chunk) {
        if (msg.status === 'pending') {
          await this.markFailed(msg);
        }
      }
    }
  }

  /**
   * Re-attempt a pending group message by re-fanning it to the current roster. Every copy keeps the
   * original messageId, so members that already received it dedupe the duplicate. If any copy still
   * fails, the message is marked 'failed' so the user can resend it manually.
   */
  private async resyncGroupMessage(msg: LocalMessage): Promise<void> {
    if (!msg.groupId || msg.status !== 'pending') {
      return;
    }

    try {
      const plaintext = await this.secureMsg.decryptFromAtRest(msg.id, msg.text);
      const res = await this.fanOutGroup(msg.id, msg.groupId, plaintext);
      if (res) {
        await this.confirmAccepted(msg.id, res);
      }
    } catch (err) {
      console.error('Failed to resync group message:', msg.id, err);
      await this.markFailed(msg);
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
      const res = await prepared.send();
      if (res) {
        await this.confirmAccepted(id, res);
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      await this.markFailed(message);
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
      send: () => lastValueFrom(this.messagesApi.sendMessage(recipientId, payload, signature, id))
    };
  }

  /**
   * Resolve a group send: fan the message out as one independent 1:1 copy per member, each sealed
   * to that member's current directory key. Every copy shares the same messageId and carries the
   * groupId for conversation threading. The caller (self) is excluded from the fan-out.
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

    return {
      groupId,
      send: () => this.fanOutGroup(id, groupId, text)
    };
  }

  /**
   * Send one independent 1:1 copy per current group member (excluding self), all sharing the
   * message's id. The roster is resolved fresh from the Server here. Resolves with the last
   * accepted response when every copy succeeds; rejects if any copy fails, leaving the message
   * pending so resync re-fans the whole message later (receivers dedupe by messageId).
   */
  private async fanOutGroup(
    messageId: string,
    groupId: string,
    text: string
  ): Promise<AcceptedResponse | undefined> {
    const myId = this.auth.currentUser()?.id;
    const members = (await this.groups.getMembers(groupId)).filter(memberId => memberId !== myId);

    const results = await Promise.all(
      members.map(async memberId => {
        const { payload, signature } = await this.secureMsg.buildOutgoingPayload(memberId, text);
        return lastValueFrom(
          this.messagesApi.sendMessage(memberId, payload, signature, messageId, groupId)
        );
      })
    );

    return results.at(-1);
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

  /** Mark a message as failed (not accepted by the Server) so the user can resend it manually. */
  private async markFailed(msg: LocalMessage): Promise<void> {
    msg.status = 'failed';
    await this.repository.updateMessage(msg)
      .catch(err => console.error('Failed to mark message failed', err));
  }
}
