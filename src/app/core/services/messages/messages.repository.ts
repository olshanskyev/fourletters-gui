import { Injectable, inject } from '@angular/core';
import { AppDatabase } from '@core/services/database/app.database';
import { LocalMessage } from './models/messages.model';
import { liveQuery } from 'dexie';
import { from, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class MessagesRepository {

  private readonly db = inject(AppDatabase);

  /**
   * Add a single message
   */
  async addMessage(message: LocalMessage): Promise<string> {
    return this.db.messages.add(message);
  }

  /**
   * Update a single message
   */
  async updateMessage(message: LocalMessage): Promise<void> {
    await this.db.messages.put(message);
  }

  /**
   * Atomically upgrade a message's delivery status (pending -> delivered -> read, never downgrades).
   * Runs in a Dexie transaction so concurrently arriving receipts for the same message can't race.
   */
  async upgradeStatus(id: string, status: 'delivered' | 'read'): Promise<void> {
    await this.db.transaction(this.db.messages, async () => {
      const msg = await this.db.messages.get(id);
      if (!msg) return;
      if (msg.status === 'read' || (msg.status === 'delivered' && status === 'delivered')) return;
      msg.status = status;
      await this.db.messages.put(msg);
    });
  }

  /**
   * Atomically mark a sent message as accepted by the Server, persisting serverStartedAt. Never
   * downgrades
   */
  async confirmAccepted(id: string, serverStartedAt?: number): Promise<void> {
    await this.db.transaction(this.db.messages, async () => {
      const msg = await this.db.messages.get(id);
      if (!msg) return;
      if (serverStartedAt) {
        msg.serverStartedAt = serverStartedAt;
      }
      if (msg.status === 'pending') {
        msg.status = 'accepted';
      }
      await this.db.messages.put(msg);
    });
  }

  /**
   * Bulk insert messages
   */
  async saveMessages(messages: LocalMessage[]): Promise<void> {
    await this.db.messages.bulkPut(messages);
  }

  /**
   * Get all messages for a specific conversation as a one-time fetch
   */
  async getMessagesByConversation(conversationId: string): Promise<LocalMessage[]> {
    return this.db.messages
      .where('conversationId').equals(conversationId)
      .sortBy('createdAt');
  }

  /**
   * Get all unconfirmed messages (both pending and accepted by the server but not yet delivered)
   */
  async getUnconfirmedMessages(): Promise<LocalMessage[]> {
    return this.db.messages
      .where('status').anyOf('pending', 'accepted')
      .filter(m => m.isMine === true)
      .toArray();
  }

  /**
   * Get a message by its ID
   */
  async getMessageById(id: string): Promise<LocalMessage | undefined> {
     return await this.db.messages.get(id);
  }

  /**
   * Check if a message exists by its ID
   */
  async hasMessage(id: string): Promise<boolean> {
    const message = await this.db.messages.get(id);
    return !!message;
  }

  /**
   * Get live updating stream of messages for a specific conversation
   */
  observeMessagesByConversation(conversationId: string): Observable<LocalMessage[]> {
    return from(
      liveQuery(() => this.db.messages.where('conversationId').equals(conversationId).sortBy('createdAt'))
    );
  }
}
