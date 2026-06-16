import { Injectable } from '@angular/core';
import { db } from '../database/app.database';
import { LocalMessage } from './models/messages.model';
import { liveQuery } from 'dexie';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class MessagesRepository {

  /**
   * Add a single message
   */
  async addMessage(message: LocalMessage): Promise<string> {
    return db.messages.add(message);
  }

  /**
   * Bulk insert messages
   */
  async saveMessages(messages: LocalMessage[]): Promise<void> {
    await db.messages.bulkPut(messages);
  }

  /**
   * Get all messages for a specific conversation as a one-time fetch
   */
  async getMessagesByConversation(conversationId: string): Promise<LocalMessage[]> {
    return db.messages
      .where('conversationId').equals(conversationId)
      .sortBy('createdAt');
  }

  /**
   * Get live updating stream of messages for a specific conversation
   */
  observeMessagesByConversation(conversationId: string): Observable<LocalMessage[]> {
    return new Observable(observer => {
      const subscription = liveQuery(
        () => db.messages.where('conversationId').equals(conversationId).sortBy('createdAt')
      ).subscribe(
        result => observer.next(result),
        error => observer.error(error)
      );

      return () => subscription.unsubscribe();
    });
  }
}
