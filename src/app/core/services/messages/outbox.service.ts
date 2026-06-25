import { Injectable, inject } from '@angular/core';
import { MessagesRepository } from './messages.repository';
import { LocalMessage, DirectMessage, GroupMessage } from './models/messages.model';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { MessagesApiService } from './messages-api.service';
import { SyncStateRepository } from './sync-state.repository';
import { SecureMessageService } from './secure-message.service';
import { GroupsService } from '@core/services/groups/groups.service';
import { AuthService } from '@core/services/authentication/auth.service';
import { lastValueFrom } from 'rxjs';
import { LocalConversation } from '@core/services/conversations/models/conversations.model';
import { AcceptedResponse, EncryptedMessage } from '@dto/models';

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

  async sendMessage(
    conversationId: string,
    text: string ): Promise<void> {

    const convo = await this.conversationsService.getConversation(conversationId);
    if (!convo) {
      console.error('Conversation not found. Message sending failed.', conversationId);
      return;
    }

    const routing = await this.resolveRouting(convo);
    if (!routing) {
      return; // routing resolution failed and was already logged
    }

    const id = crypto.randomUUID();
    const time = Date.now();

    // Build the outbox record (at-rest plaintext). Ciphertext is produced lazily during dispatch.
    const message: LocalMessage = {
      ...routing,
      id,
      conversationId: convo.id,
      senderId: 'me', // Placeholder, real senderId the server calculates based on auth
      text: await this.secureMsg.encryptForAtRest(id, text),
      isMine: true,
      createdAt: time,
      status: 'pending',
      retryCount: 0,
      ciphers: {}
    };

    // Persist before transmitting so a send/encrypt failure can be marked for manual resend.
    await this.persistOutgoing(message, text, time);

    try {
      const res = await this.dispatch(message);
      if (res) {
        await this.confirmAccepted(id, res);
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      await this.markFailed(message);
    }
  }

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
   * Re-key and resend a copy after the recipient NACK'd it (they changed device). Opens a fresh
   * session from their new bundle and re-encrypts — the one place re-encryption is correct. For a
   * group message it re-keys only the single member that NACK'd, identified by senderId.
   */
  async resendAfterKeyChange(messageId: string, senderId: string): Promise<void> {
    const msg = await this.repository.getMessageById(messageId);
    if (!msg || !msg.isMine) {
      return;
    }
    const targetId = msg.kind === 'group' ? senderId : msg.recipientId;
    if (!targetId) {
      return;
    }
    const nackResent = msg.nackResent ?? new Set<string>();
    if (nackResent.has(targetId)) {
      // Already retried this recipient once under a fresh key and still undecryptable: give up.
      await this.markFailed(msg);
      return;
    }

    try {
      const plaintext = await this.secureMsg.decryptFromAtRest(msg.id, msg.text);
      const { payload } = await this.secureMsg.buildOutgoingPayload(targetId, plaintext, true);
      msg.ciphers = { ...(msg.ciphers ?? {}), [targetId]: payload };
      nackResent.add(targetId);
      msg.nackResent = nackResent;
      msg.status = 'pending';
      await this.repository.updateMessage(msg);

      const res = await lastValueFrom(
        this.messagesApi.sendMessage(targetId, payload, msg.id, msg.groupId)
      );
      await this.confirmAccepted(msg.id, res);
    } catch (err) {
      console.error('Failed to resend message after key change:', messageId, err);
      await this.markFailed(msg);
    }
  }

  /**
   * Manually re-send a message the user previously saw fail. Re-transmits stored ciphertext; only
   * group members that never got a copy are freshly encrypted.
   */
  async resend(messageId: string): Promise<void> {
    const msg = await this.repository.getMessageById(messageId);
    if (!msg || !msg.isMine || msg.status !== 'failed') {
      return;
    }

    msg.status = 'pending';
    await this.repository.updateMessage(msg);

    try {
      const res = await this.dispatch(msg);
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
   * Partition the unconfirmed outbox into the messages that need re-sending
   */
  private async collectResends(
    pendingMessages: LocalMessage[],
    currentServerStartedAt: number
  ): Promise<{ direct: DirectMessage[]; group: GroupMessage[] }> {
    const direct: DirectMessage[] = [];
    const group: GroupMessage[] = [];

    for (const msg of pendingMessages) {
      let include = false;
      if (msg.status === 'pending') {
        // Never accepted by the Server (the initial send failed): re-attempt once.
        include = true;
      } else if (
        msg.status === 'accepted' &&
        msg.serverStartedAt !== currentServerStartedAt &&
        !msg.retryCount
      ) {
        // Accepted, then the Server restarted before delivering it: re-push once.
        msg.retryCount = 1;
        await this.repository.updateMessage(msg);
        include = true;
      }
      if (!include) {
        continue;
      }
      if (msg.kind === 'group') {
        group.push(msg);
      } else {
        direct.push(msg);
      }
    }

    return { direct, group };
  }

  /**
   * Re-submit a batch of direct messages, re-transmitting each one's stored ciphertext. Accepted
   * copies move to 'accepted'; any never-accepted message is marked 'failed'.
   */
  private async resendDirectBatch(chunk: DirectMessage[]): Promise<void> {
    const messages: EncryptedMessage[] = [];
    for (const msg of chunk) {
      const recipientId = msg.recipientId;
      const payload = await this.cipherFor(msg, recipientId);
      messages.push({ messageId: msg.id, recipientId, payload });
    }
    // Persist any ciphertext freshly created above (e.g. a never-encrypted pending message).
    await Promise.all(chunk.map(msg => this.repository.updateMessage(msg).catch(() => undefined)));

    try {
      const res = await lastValueFrom(this.messagesApi.sendMessagesBatch(messages));
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
   * Re-fan a group message (already selected by collectResends) to the current roster.
   */
  private async resyncGroupMessage(msg: GroupMessage): Promise<void> {
    const wasPending = msg.status === 'pending';

    try {
      const res = await this.fanOutGroup(msg);
      if (res) {
        await this.confirmAccepted(msg.id, res);
      }
    } catch (err) {
      console.error('Failed to resync group message:', msg.id, err);
      if (wasPending) {
        await this.markFailed(msg);
      }
    }
  }



  /** Resolve a conversation's routing: the direct peer, or the group it fans out to. */
  private async resolveRouting(
    convo: LocalConversation
  ): Promise<{ kind: 'direct'; recipientId: string } | { kind: 'group'; groupId: string } | undefined> {
    if (convo.type === 'group') {
      if (!convo.groupId) {
        console.error('Group conversation missing groupId. Message sending failed.', convo.id);
        return undefined;
      }
      return { kind: 'group', groupId: convo.groupId };
    }
    const recipientId = convo.participants?.[0];
    if (!recipientId) {
      console.error('No recipient found for conversation. Message sending failed.', convo.id);
      return undefined;
    }
    return { kind: 'direct', recipientId };
  }

  /** Transmit a message's ciphertext to its destination: a group fan-out or a single 1:1 send. */
  private dispatch(msg: LocalMessage): Promise<AcceptedResponse | undefined> {
    return msg.kind === 'group'
      ? this.fanOutGroup(msg)
      : this.sendDirect(msg, msg.recipientId);
  }

  /** Transmit the stored 1:1 ciphertext to a single recipient. */
  private async sendDirect(msg: DirectMessage, recipientId: string)
    : Promise<AcceptedResponse | undefined> {
    const payload = await this.cipherFor(msg, recipientId);
    await this.repository.updateMessage(msg).catch(() => undefined); // persist a freshly created cipher
    return lastValueFrom(this.messagesApi.sendMessage(recipientId, payload, msg.id));
  }

  /**
   * Send one independent 1:1 copy per current group member (excluding self), all sharing the
   * message's id and carrying the groupId for threading. Reuses each member's stored ciphertext and
   * only encrypts for members that lack one (e.g. joined since the message was first sent).
   */
  private async fanOutGroup(msg: GroupMessage): Promise<AcceptedResponse | undefined> {
    const groupId = msg.groupId;
    const myId = this.auth.currentUser()?.id;
    const members = (await this.groups.getMembers(groupId)).filter(memberId => memberId !== myId);

    const results = await Promise.all(
      members.map(async memberId => {
        const payload = await this.cipherFor(msg, memberId);
        return lastValueFrom(
          this.messagesApi.sendMessage(memberId, payload, msg.id, groupId)
        );
      })
    );
    await this.repository.updateMessage(msg).catch(() => undefined); // persist any new ciphers

    return results.at(-1);
  }

  /**
   * The exact ciphertext to (re)send to a recipient. Returns the stored bytes when present;
   * otherwise encrypts the at-rest plaintext once and records it (mutates msg.ciphers).
   */
  private async cipherFor(msg: LocalMessage, recipientId: string): Promise<string> {
    const existing = msg.ciphers?.[recipientId];
    if (existing) {
      return existing;
    }
    const plaintext = await this.secureMsg.decryptFromAtRest(msg.id, msg.text);
    const { payload } = await this.secureMsg.buildOutgoingPayload(recipientId, plaintext);
    msg.ciphers = { ...(msg.ciphers ?? {}), [recipientId]: payload };
    return payload;
  }

  /**
   * Persist a freshly built outgoing message to the local outbox and refresh the conversation
   * preview with its plaintext.
   */
  private async persistOutgoing(message: LocalMessage, previewText: string, time: number)
    : Promise<void> {
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
