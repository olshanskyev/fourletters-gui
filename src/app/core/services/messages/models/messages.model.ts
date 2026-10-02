import { CallDirection, CallMedia, CallOutcome } from '@core/services/calls/models/call.model';

export type MessageStatus = 'pending' | 'accepted' | 'delivered' | 'read' | 'failed';


export type MessageContentType = 'text' | 'image';

export interface MessageContent { type: MessageContentType; text: string }

/** Conversation-list preview for a message; images show a placeholder, never the raw data URL. */
export function messagePreview(contentType: MessageContentType, text: string): string {
  return contentType === 'image' ? 'Photo' : text;
}

interface BaseMessage {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  contentType?: MessageContentType;
  isMine: boolean;
  createdAt: number; // ordering/display key
  sentAt?: number;
  receivedAt?: number;
  status?: MessageStatus;
  serverStartedAt?: number; // For outbox resync when server restarts
  retryCount?: number; // delivery attempts: pending re-sends (failed after a budget) and the one post-restart re-push; reset to 0 on accept
  nackResent?: Set<string>; // recipientIds already re-keyed and resent once after an 'undecryptable' NACK
  cipher?: string; // exact wire ciphertext for idempotent resend
}

/** A 1:1 message: routed to a single peer. */
export interface DirectMessage extends BaseMessage {
  kind: 'direct';
  recipientId: string;
  groupId?: undefined; // guard: a direct message has no groupId
}

/** A group message: encrypted once with the sender's group Sender Key. */
export interface GroupMessage extends BaseMessage {
  kind: 'group';
  groupId: string;
  recipientId?: undefined; // guard: a group message has no recipientId
  epoch?: number; // group Sender-Key epoch this copy was encrypted under
}

export type SystemMessageType = 'identity-changed' | 'call';

/** Local call-log details of a 'call' system message. */
export interface CallLogEntry {
  media: CallMedia;
  direction: CallDirection;
  outcome: CallOutcome;
  durationSec?: number; // set when outcome is 'ended'
}

/** Conversation-list preview for a call-log entry. */
export function callPreview(entry: CallLogEntry): string {
  if (entry.outcome === 'missed') {
    return entry.direction === 'incoming' ? 'Missed call' : 'No answer';
  }
  const kind = entry.media === 'video' ? 'video call' : 'voice call';
  return `${entry.direction === 'incoming' ? 'Incoming' : 'Outgoing'} ${kind}`;
}

/** A locally generated, non-encrypted timeline notice (identity-key change, call log). */
export interface SystemMessage extends BaseMessage {
  kind: 'system';
  systemType: SystemMessageType;
  call?: CallLogEntry; // set when systemType is 'call'
  recipientId?: undefined; // guard: never routed
  groupId?: undefined;
}

export type LocalMessage = DirectMessage | GroupMessage | SystemMessage;
