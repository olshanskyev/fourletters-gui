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
import { HubService } from '../../core';
import { MessagesService } from '../../core/services/messages';
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
  hubService = inject(HubService);
  messagesService = inject(MessagesService);

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

    // Send via WebSocket
    this.hubService.sendMessage(convoId, text);

    // Save to IndexedDB (updates UI via signals automatically)
    await this.messagesService.saveMessage(convoId, text, true);

    this.messageText.set('');
  }
}