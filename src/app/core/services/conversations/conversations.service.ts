import { Injectable, inject } from '@angular/core';
import { ConversationsRepository } from './conversations.repository';
import { LocalConversation, ConversationType } from './models/conversations.model';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ConversationsService {
  private repository = inject(ConversationsRepository);

  /**
   * Observe all conversations to populate the sidebar list
   */
  observeConversations(): Observable<LocalConversation[]> {
    return this.repository.observeConversations();
  }

  /**
   * Get a conversation by ID
   */
  async getConversation(id: string): Promise<LocalConversation | undefined> {
    const convo = await this.repository.getConversation(id);
    if (convo && !convo.type) {
      // Migrate old data on the fly
      convo.type = 'direct';
      convo.participants = [convo.id];
    }
    return convo;
  }

  /**
   * Finds an existing direct conversation with a specific user
   */
  async getDirectConversationWith(userId: string): Promise<LocalConversation | undefined> {
    // This is simple since we store all locally. As arrays grow, consider a Dexie index.
    const all = await this.repository.getAllConversations();
    return all.find(c => c.type === 'direct' && c.participants?.includes(userId));
  }

  /**
   * Create a new conversation
   */
  async createConversation(
    name: string,
    type: ConversationType = 'direct',
    participants: string[] = []
  ): Promise<LocalConversation> {
    const id = crypto.randomUUID();
    const conversation: LocalConversation = {
      id,
      name,
      type,
      participants,
      unreadCount: 0,
      updatedAt: Date.now(),
    };

    await this.repository.putConversation(conversation);
    return conversation;
  }

  /**
   * Update the latest message of a conversation
   */
  async updateLastMessage(id: string, text: string, time: number): Promise<void> {
    const existing = await this.repository.getConversation(id);
    if (!existing) return;

    existing.lastMessageText = text;
    existing.lastMessageAt = time;
    existing.updatedAt = time; // Sort to top

    await this.repository.putConversation(existing);
  }
}
