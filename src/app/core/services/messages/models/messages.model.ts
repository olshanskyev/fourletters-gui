export type MessageStatus = 'pending' | 'accepted' | 'delivered' | 'read' | 'failed';

export interface LocalMessage {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId?: string; // The 1:1 peer (direct messages only); absent for group messages
  groupId?: string; // Set for group messages only; the discriminator between direct and group
  text: string;
  isMine: boolean;
  createdAt: number;
  status?: MessageStatus;
  serverStartedAt?: number; // For outbox resync when server restarts
  retryCount?: number;
  nackResent?: boolean; // True once re-keyed and resent after an 'undecryptable' NACK (resend once)
}
