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
   * Delete a conversation by ID
   */
  async deleteConversation(id: string): Promise<void> {
    await this.db.conversations.delete(id);
  }

  /**
   * Atomically add `delta` to a conversation's unread count (clamped at 0). The read-modify-write
   * runs in a Dexie transaction so a concurrent incoming (+1) and read (-1) can't clobber each other.
   */
  async adjustUnreadCount(id: string, delta: number): Promise<void> {
    await this.db.transaction(this.db.conversations, async () => {
      const c = await this.db.conversations.get(id);
      if (!c) return;
      c.unreadCount = Math.max(0, c.unreadCount + delta);
      await this.db.conversations.put(c);
    });
  }

  /**
   * Set a conversation's unread count to an absolute value (clamped at 0). Used to reconcile the
   * incrementally-maintained counter with the true number of unread messages.
   */
  async setUnreadCount(id: string, value: number): Promise<void> {
    await this.db.transaction(this.db.conversations, async () => {
      const c = await this.db.conversations.get(id);
      if (!c) return;
      c.unreadCount = Math.max(0, value);
      await this.db.conversations.put(c);
    });
  }

  /**
   * Get all conversations one-time fetch
   */
  async getAllConversations(): Promise<LocalConversation[]> {
    return this.db.conversations.toArray();
  }

  /**
   * Observe conversations projected through `project`, within a single live query. Any Dexie reads
   * performed by `project` (e.g. cached profiles/groups) are tracked too, so the stream re-emits
   * when that metadata changes.
   */
  observeConversationsProjected<T>(
    project: (conversations: LocalConversation[]) => Promise<T>
  ): Observable<T> {
    return from(
      liveQuery(() =>
        this.db.conversations.orderBy('updatedAt').reverse().toArray().then(project)
      )
    );
  }

  /**
   * Observe a single conversation projected through `project`, within one live query. Like
   * {@link observeConversationsProjected}, any Dexie reads `project` performs are tracked, so the
   * stream re-emits when the conversation or its cached metadata changes.
   */
  observeConversationProjected<T>(
    id: string,
    project: (conversation: LocalConversation | undefined) => Promise<T>
  ): Observable<T> {
    return from(
      liveQuery(() => this.db.conversations.get(id).then(project))
    );
  }
}
