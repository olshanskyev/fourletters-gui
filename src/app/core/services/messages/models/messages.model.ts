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

export type LocalMessage = DirectMessage | GroupMessage;
