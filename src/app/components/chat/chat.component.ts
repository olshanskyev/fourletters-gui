import { Component, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatLayoutComponent } from '../../layouts/chat-layout/chat-layout.component';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { TextFieldModule } from '@angular/cdk/text-field';
import { SidePanelService } from '../../core/services/shared/side-panel.service';
import { ChatDetailsComponent } from './chat-details/chat-details.component';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MessagesService } from '../../core/services/messages';
import { MessagesApiService } from '../../core/services/messages/messages-api.service';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { switchMap, of } from 'rxjs';

@Component({
  selector: 'app-chat',
  standalone: true,
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
  imports: [
    FormsModule,
    CommonModule,
    ChatLayoutComponent,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    TextFieldModule,
    MatIconModule,
    RouterLink,
  ]
})
export class ChatComponent {
  sidePanelService = inject(SidePanelService);
  messagesService = inject(MessagesService);
  messagesApi = inject(MessagesApiService);
  conversationId = input<string | undefined>(undefined);
  showBackButton = input<boolean>(true);

  messages = toSignal(
    toObservable(this.conversationId).pipe(
      switchMap(id => {
        if (id) {
          return this.messagesService.observeMessages(id);
        }
        return of([]);
      })
    ),
    { initialValue: [] }
  );

  messageText = signal<string>('');

  openChatDetails() {
    this.sidePanelService.open(ChatDetailsComponent);
  }

  async sendMessage() {
    const convoId = this.conversationId();
    const text = this.messageText();
    if (!convoId || !text) return;

    // Save to IndexedDB first so the message shows immediately (updates UI via signals).
    const message = await this.messagesService.saveMessage(convoId, text, true);

    this.messagesApi.sendMessage(convoId, text, message.id).subscribe({
      error: (err) => console.error('Failed to send message:', err)
    });

    this.messageText.set('');
  }
}