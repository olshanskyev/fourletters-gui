import { Injectable, signal } from '@angular/core';
import { LocalMessage } from '@core/services/messages/models/messages.model';

export interface SelectedMessage {
  message: LocalMessage;
  element: HTMLElement;
}

/** The message currently lifted for reacting, if any. */
@Injectable({
  providedIn: 'root'
})
export class MessageSelectionService {
  readonly selectedMessage = signal<SelectedMessage | undefined>(undefined);

  select(message: LocalMessage, element: HTMLElement): void {
    this.selectedMessage.set({ message, element });
  }

  clear(): void {
    this.selectedMessage.set(undefined);
  }
}
