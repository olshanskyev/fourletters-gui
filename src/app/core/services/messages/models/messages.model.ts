export type MessageStatus = 'pending' | 'accepted' | 'delivered' | 'read';

export interface LocalMessage {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  isMine: boolean;
  createdAt: number;
  status?: MessageStatus;
  serverStartedAt?: number; // For outbox resync when server restarts
  retryCount?: number;
}
