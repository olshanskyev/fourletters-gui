export type ConversationType = 'direct' | 'group';

export interface LocalConversation {
  id: string;
  name: string;
  type: ConversationType;
  participants: string[];
  lastMessageText?: string;
  lastMessageAt?: number;
  unreadCount: number;
  updatedAt: number;
}
