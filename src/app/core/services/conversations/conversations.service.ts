import { Injectable, inject } from '@angular/core';
import { ConversationsRepository } from './conversations.repository';
import { LocalConversation } from './models/conversations.model';
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
   * Initialize a new conversation or get an existing one
   */
  async createOrUpdateConversation(id: string, name: string): Promise<LocalConversation> {
    const existing = await this.repository.getConversation(id);

    const conversation: LocalConversation = {
      id,
      name,
      unreadCount: existing ? existing.unreadCount : 0,
      updatedAt: existing ? existing.updatedAt : Date.now(),
      lastMessageText: existing?.lastMessageText,
      lastMessageAt: existing?.lastMessageAt
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
