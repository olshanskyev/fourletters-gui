export interface LocalConversation {
  id: string;
  name: string;
  lastMessageText?: string;
  lastMessageAt?: number;
  unreadCount: number;
  updatedAt: number;
}
