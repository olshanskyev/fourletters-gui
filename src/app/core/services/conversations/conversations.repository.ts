import { Injectable } from '@angular/core';
import { db } from '../database/app.database';
import { LocalConversation } from './models/conversations.model';
import { liveQuery } from 'dexie';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ConversationsRepository {

  /**
   * Add or update a conversation
   */
  async putConversation(conversation: LocalConversation): Promise<string> {
    return db.conversations.put(conversation);
  }

  /**
   * Get a conversation by ID
   */
  async getConversation(id: string): Promise<LocalConversation | undefined> {
    return db.conversations.get(id);
  }

  /**
   * Observe all conversations (sorted by latest activity)
   */
  observeConversations(): Observable<LocalConversation[]> {
    return new Observable(observer => {
      const subscription = liveQuery(
        () => db.conversations.orderBy('updatedAt').reverse().toArray()
      ).subscribe(
        result => observer.next(result),
        error => observer.error(error)
      );

      return () => subscription.unsubscribe();
    });
  }
}
