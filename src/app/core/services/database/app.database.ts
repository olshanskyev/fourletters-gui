import Dexie, { Table } from 'dexie';
import { LocalMessage } from '../messages/models/messages.model';
import { LocalConversation } from '../conversations/models/conversations.model';

export class AppDatabase extends Dexie {
  messages!: Table<LocalMessage, string>;
  conversations!: Table<LocalConversation, string>;

  constructor() {
    super('FourLettersDB');


    this.version(1).stores({
      messages: 'id, conversationId, createdAt, status',
      conversations: 'id, updatedAt'
    });
  }
}

export const db = new AppDatabase();
