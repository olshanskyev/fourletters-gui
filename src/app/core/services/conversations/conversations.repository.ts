import { Injectable, inject } from '@angular/core';
import { AppDatabase } from '@core/services/database/app.database';
import { LocalConversation } from './models/conversations.model';
import { liveQuery } from 'dexie';
import { from, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ConversationsRepository {

  private readonly db = inject(AppDatabase);

  /**
   * Add or update a conversation
   */
  async putConversation(conversation: LocalConversation): Promise<string> {
    return this.db.conversations.put(conversation);
  }

  /**
   * Get a conversation by ID
   */
  async getConversation(id: string): Promise<LocalConversation | undefined> {
    return this.db.conversations.get(id);
  }

  /**
   * Get all conversations one-time fetch
   */
  async getAllConversations(): Promise<LocalConversation[]> {
    return this.db.conversations.toArray();
  }

  /**
   * Observe all conversations (sorted by latest activity)
   */
  observeConversations(): Observable<LocalConversation[]> {
     return from(
      liveQuery(() => this.db.conversations.orderBy('updatedAt').reverse().toArray())
    );
  }
}
