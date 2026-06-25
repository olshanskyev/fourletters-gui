export type MessageStatus = 'pending' | 'accepted' | 'delivered' | 'read' | 'failed';

interface BaseMessage {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  isMine: boolean;
  createdAt: number;
  status?: MessageStatus;
  serverStartedAt?: number; // For outbox resync when server restarts
  retryCount?: number; // For outbox resync when server restarts
  nackResent?: Set<string>; // recipientIds already re-keyed and resent once after an 'undecryptable' NACK
  ciphers?: Record<string, string>; // recipientId → exact Signal wire payload, for idempotent resend
}

/** A 1:1 message: routed to a single peer. */
export interface DirectMessage extends BaseMessage {
  kind: 'direct';
  recipientId: string;
  groupId?: undefined;
}

/** A group message: fanned out as independent 1:1 copies sharing this groupId for threading. */
export interface GroupMessage extends BaseMessage {
  kind: 'group';
  groupId: string;
  recipientId?: undefined;
}

export type LocalMessage = DirectMessage | GroupMessage;
