import { Injectable, inject } from '@angular/core';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { MessagesRepository } from '@core/services/messages/messages.repository';
import {
  CallLogEntry,
  SystemMessage,
  callPreview
} from '@core/services/messages/models/messages.model';

/** Writes finished calls into the chat as local-only system messages. */
@Injectable({
  providedIn: 'root'
})
export class CallHistoryService {
  private repository = inject(MessagesRepository);
  private conversations = inject(ConversationsService);

  async log(
    conversationId: string, peerId: string, callId: string, at: number, entry: CallLogEntry
  ): Promise<void> {
    const outgoing = entry.direction === 'outgoing';
    const message: SystemMessage = {
      kind: 'system',
      id: `sys-call-${callId}`,
      conversationId,
      senderId: outgoing ? 'me' : peerId,
      text: '',
      isMine: outgoing,
      createdAt: at,
      systemType: 'call',
      call: entry
    };
    try {
      // put, not add: an offer redelivered after a restart must not log the call twice.
      await this.repository.updateMessage(message);
      await this.conversations.updateLastMessage(conversationId, callPreview(entry), at);
    } catch (err) {
      console.error('Failed to write call log entry', err);
    }
  }
}
