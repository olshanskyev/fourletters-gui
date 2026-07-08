import { Component, effect, inject, input, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatLayoutComponent } from '@layouts/chat-layout/chat-layout.component';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { TextFieldModule } from '@angular/cdk/text-field';
import { SidePanelService } from '@core/services/shared/side-panel.service';
import { ChatDetailsComponent } from './chat-details/chat-details.component';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { toSignal, toObservable, rxResource } from '@angular/core/rxjs-interop';
import { switchMap, of } from 'rxjs';
import { SettingsService } from '@core/services/shared/settings.service';
import { LocalMessage } from '@core/services/messages/models/messages.model';
import { ObserveVisibilityDirective } from './observe-visibility.directive';
import { DecryptMessagePipe } from './decrypt-message.pipe';
import { MessagesService } from '@core/services/messages/messages.service';
import { ConversationsService } from '@core/services/conversations/conversations.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    ObserveVisibilityDirective,
    DecryptMessagePipe,
  ],
})
export class ChatComponent {
  sidePanelService = inject(SidePanelService);
  messagesService = inject(MessagesService);
  private conversationsService = inject(ConversationsService);
  conversationId = input<string | undefined>(undefined);
  showBackButton = input<boolean>(true);
  settingsService = inject(SettingsService);
  locale = this.settingsService.locale;
  messages = toSignal(
    toObservable(this.conversationId).pipe(
      switchMap((id) => {
        if (id) {
          return this.messagesService.observeMessages(id);
        }
        return of([]);
      }),
    ),
    { initialValue: [] },
  );

  // Live conversation header metadata (title, avatar). Re-emits when the conversation or its cached
  // profile/group metadata changes
  conversation = rxResource({
    params: () => this.conversationId(),
    stream: ({ params: id }) => this.conversationsService.observeConversationView(id),
  });

  messageText = signal<string>('');

  openChatDetails() {
    this.sidePanelService.open(ChatDetailsComponent);
  }

  async sendMessage() {
    const convoId = this.conversationId();
    const text = this.messageText();
    if (!convoId || !text) return;

    await this.messagesService.sendMessage(convoId, text);

    this.messageText.set('');
  }

  onMessageVisible(msg: LocalMessage) {
    if (!msg.isMine && msg.status !== 'read') {
      // Mark as read locally and send receipt via MessagesService
      this.messagesService.markAsRead(msg);
    }
  }
}
