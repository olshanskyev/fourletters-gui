export type ConversationType = 'direct' | 'group';

export interface LocalConversation {
  id: string;
  name: string;
  type: ConversationType;
  participants: string[];
  groupId?: string; // For group conversations
  lastMessageText?: string;
  lastMessageAt?: number;
  unreadCount: number;
  updatedAt: number;

}
