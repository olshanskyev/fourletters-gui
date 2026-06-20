export type ConversationType = 'direct' | 'group';

export interface LocalConversation {
  id: string;
  name: string;
  type: ConversationType;
  participants: string[];
  groupId?: string; // For group conversations, an optional ID for server-side grouping
  lastMessageText?: string;
  lastMessageAt?: number;
  unreadCount: number;
  updatedAt: number;

}
