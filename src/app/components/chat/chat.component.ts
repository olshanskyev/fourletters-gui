import { Component, computed, inject, input, resource, signal, ChangeDetectionStrategy } from '@angular/core';
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
import { TranslateModule } from '@ngx-translate/core';

import { toSignal, toObservable, rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap, of, Subject, bufferTime, filter } from 'rxjs';
import { SettingsService } from '@core/services/shared/settings.service';
import { LocalMessage } from '@core/services/messages/models/messages.model';
import { ObserveVisibilityDirective } from './observe-visibility.directive';
import { DecryptMessagePipe } from './decrypt-message.pipe';
import { MessagesService } from '@core/services/messages/messages.service';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { UsersService } from '@core/services/users/users.service';

interface DaySection {
  id: string;
  date: number;
  messages: LocalMessage[];
}

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
    TranslateModule
  ],
})
export class ChatComponent {
  sidePanelService = inject(SidePanelService);
  messagesService = inject(MessagesService);
  private conversationsService = inject(ConversationsService);
  private usersService = inject(UsersService);
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

  isGroupConversation = computed(() => this.conversation.value()?.kind === 'group');

  // Messages grouped into day sections so each date header stays pinned only within its own day.
  timeline = computed<DaySection[]>(() => {
    const sections: DaySection[] = [];
    let current: DaySection | undefined;
    for (const message of this.messages()) {
      const day = new Date(message.createdAt).setHours(0, 0, 0, 0);
      if (!current || current.date !== day) {
        current = { id: `day-${day}`, date: day, messages: [] };
        sections.push(current);
      }
      current.messages.push(message);
    }
    return sections;
  });

  private groupSenderIds = computed(
    () => {
      if (!this.isGroupConversation()) {
        return [];
      }
      return [...new Set(this.messages().filter(
        (msg) => !msg.isMine).map((msg) => msg.senderId)
      )].sort();
    },
    { equal: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) },
  );

  private profilesResource = resource({
    params: () => this.groupSenderIds(),
    loader: async ({ params: senderIds }) => {
      const profiles = await Promise.all(senderIds.map((id) => this.usersService.getProfile(id)));
      return Object.fromEntries(senderIds.map((id, i) => [
        id,
        {
          avatar: profiles[i]?.localAvatarUrl || profiles[i]?.avatarUrl,
          name: profiles[i]?.localName || profiles[i]?.username,
        },
      ]));
    },
  });

  // Messages that scrolled into view, coalesced so a backlog opened at once is acknowledged in one
  // batched read receipt instead of one request per message.
  private readQueue = new Subject<LocalMessage>();

  constructor() {
    this.readQueue.pipe(
      bufferTime(400),
      filter((batch) => batch.length > 0),
      takeUntilDestroyed(),
    ).subscribe((batch) => {
      const unique = [...new Map(batch.map((m) => [m.id, m])).values()];
      this.messagesService.markManyAsRead(unique);
    });
  }

  messageText = signal<string>('');

  openChatDetails() {
    this.sidePanelService.open(ChatDetailsComponent, {
      conversationView: this.conversation.value(),
    });
  }

  async sendMessage() {
    const convoId = this.conversationId();
    const text = this.messageText();
    if (!convoId || !text) return;

    this.messageText.set('');
    await this.messagesService.sendMessage(convoId, text);

  }

  onMessageVisible(msg: LocalMessage) {
    if (!msg.isMine && msg.status !== 'read') {
      // Queue for a batched read receipt (see readQueue).
      this.readQueue.next(msg);
    }
  }

  messageAvatar(senderId: string): string | undefined {
    return this.profilesResource.value()?.[senderId]?.avatar;
  }

  messageSenderName(senderId: string): string | undefined {
    return this.profilesResource.value()?.[senderId]?.name;
  }
}


