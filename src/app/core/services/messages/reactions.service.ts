import { Injectable, inject } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { EncryptedMessage, MessageHint } from '@dto/models';
import { AuthService } from '@core/services/authentication/auth.service';
import { MessagesRepository } from './messages.repository';
import { MessagesApiService } from './messages-api.service';
import { LocalMessage } from './models/messages.model';
import {
  REACTION_EMOJIS, REACTION_PAYLOAD_PREFIX, ReactionPayload,
} from './models/reactions.model';

/** Sends and applies plaintext message reactions (one per reactor per message). */
@Injectable({
  providedIn: 'root'
})
export class ReactionsService {
  private repository = inject(MessagesRepository);
  private messagesApi = inject(MessagesApiService);
  private auth = inject(AuthService);

  static isReactionPayload(payload: string | undefined): boolean {
    return !!payload?.startsWith(REACTION_PAYLOAD_PREFIX);
  }

  /** Toggle (same emoji) or replace the current user's reaction; reverted if sending fails. */
  async react(message: LocalMessage, emoji: string): Promise<void> {
    const myId = this.auth.currentUser()?.id;
    if (!myId || message.kind === 'system' || !REACTION_EMOJIS.includes(emoji)) {
      return;
    }
    const previous = message.reactions?.[myId];
    const next = previous?.emoji === emoji ? '' : emoji;
    const ts = Date.now();
    const payload: ReactionPayload = {
      kind: 'reaction', target: message.id, emoji: next, ts,
      ...(message.isMine ? {} : { notifyId: message.senderId }),
    };
    await this.repository.setReaction(message.id, myId, { emoji: next, ts }, true);

    const body = REACTION_PAYLOAD_PREFIX + JSON.stringify(payload);
    const messageId = crypto.randomUUID();
    try {
      if (message.kind === 'group') {
        await lastValueFrom(
          this.messagesApi.sendGroupMessage(message.groupId, body, messageId, MessageHint.Reaction)
        );
      } else {
        const peerId = message.isMine ? message.recipientId : message.senderId;
        await lastValueFrom(
          this.messagesApi.sendMessage(peerId, body, messageId, undefined, MessageHint.Reaction)
        );
      }
    } catch (err) {
      await this.repository.setReaction(message.id, myId, previous, true);
      throw err;
    }
  }

  /** Apply an incoming reaction if valid for a known message of the same conversation. */
  async applyIncoming(encryptedMessage: EncryptedMessage): Promise<void> {
    const { senderId, groupId, payload } = encryptedMessage;
    const reaction = ReactionsService.parse(payload);
    if (!senderId || !reaction) {
      return;
    }
    const target = await this.repository.getMessageById(reaction.target);
    const sameConversation = groupId
      ? target?.kind === 'group' && target.groupId === groupId
      : target?.kind === 'direct'
        && (target.isMine ? target.recipientId : target.senderId) === senderId;
    if (!target || !sameConversation) {
      return;
    }
    const { emoji, ts } = reaction;
    await this.repository.setReaction(target.id, senderId, { emoji, ts });
  }

  private static parse(payload: string): ReactionPayload | undefined {
    try {
      const value = JSON.parse(payload.slice(REACTION_PAYLOAD_PREFIX.length));
      const valid = value?.kind === 'reaction'
        && typeof value.target === 'string'
        && (value.emoji === '' || REACTION_EMOJIS.includes(value.emoji))
        && Number.isFinite(value.ts);
      return valid ? value : undefined;
    } catch {
      return undefined;
    }
  }
}
