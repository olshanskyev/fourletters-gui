export type ConversationKind = 'direct' | 'group';

/**
 * A thin, local-authoritative pointer to a chat thread. It owns only local threading state
 * (preview, unread count, ordering) and a reference to the authoritative entity — a peer user
 * or a server-owned group.
 */
export interface LocalConversation {
  id: string;
  kind: ConversationKind;
  peerId?: string;   // set when kind === 'direct'
  groupId?: string;  // set when kind === 'group'
  lastMessageText?: string;
  lastMessageAt?: number;
  unreadCount: number;
  updatedAt: number;
}

/**
 * A read-time projection of a LocalConversation joined with its resolved display metadata
 * (name, avatar, roster). This is what the UI binds to; it is never persisted.
 */
export interface ConversationView {
  id: string;
  kind: ConversationKind;
  title: string;
  avatarUrl?: string;
  participants: string[]; // [peerId] for direct; the roster for group
  lastMessageText?: string;
  lastMessageAt?: number;
  unreadCount: number;
}
