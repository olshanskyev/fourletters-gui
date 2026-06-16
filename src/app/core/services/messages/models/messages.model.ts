export interface LocalMessage {
  id: string;
  conversationId: string;
  text: string;
  isMine: boolean;
  createdAt: number;
}
