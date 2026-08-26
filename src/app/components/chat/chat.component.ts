import { Component, computed, effect, inject, input, resource, signal, ChangeDetectionStrategy } from '@angular/core';
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
import { switchMap, of, Subject, bufferTime, filter, fromEvent } from 'rxjs';
import { SettingsService } from '@core/services/shared/settings.service';
import { LocalMessage } from '@core/services/messages/models/messages.model';
import { ObserveVisibilityDirective } from './observe-visibility.directive';
import { DecryptMessagePipe } from './decrypt-message.pipe';
import { LinkifyPipe } from './linkify.pipe';
import { ConnectionStatus } from '../widgets/connection-status';
import { MessagesService } from '@core/services/messages/messages.service';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { UsersService } from '@core/services/users/users.service';
import { HubService } from '@core/services/messages/ws/hub.service';
import { MatMenuModule } from '@angular/material/menu';
import { compressImageToDataUrl } from '@core/utils/image-compression';

interface DaySection {
  id: string;
  date: number;
  messages: LocalMessage[];
}

/** Encoding preset for chat photos: a larger edge and single quality, capped near the server limit. */
const PHOTO_OPTIONS = {
  maxDimension: 1280,
  qualitySteps: [0.7],
  maxDataUrlLength: 10 * 1024 * 1024,
};

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
    LinkifyPipe,
    TranslateModule,
    MatMenuModule,
    ConnectionStatus
  ],
})
export class ChatComponent {
  sidePanelService = inject(SidePanelService);
  messagesService = inject(MessagesService);
  private conversationsService = inject(ConversationsService);
  private usersService = inject(UsersService);
  private hubService = inject(HubService);
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

  // Presence applies to 1:1 chats only; the peer is the sole participant of a direct conversation.
  peerId = computed(() => {
    const view = this.conversation.value();
    return view?.kind === 'direct' ? view.participants[0] : undefined;
  });
  readonly peerOnline = signal(false);
  readonly peerTyping = signal(false);
  private typingClearTimer?: ReturnType<typeof setTimeout>;
  private lastTypingSentAt = 0;

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

  // Messages seen while the app was backgrounded. We must NOT tell the sender they were read until
  // the user actually brings the app to the foreground, so they are held here and flushed on return.
  private pendingReads = new Map<string, LocalMessage>();

  // A read receipt is a fire-once backend call, so it must only leave a document that has settled -
  // not one iOS is about to replace on resume (which would abort the request). The document counts
  // as stable only after staying visible for READ_STABILITY_MS; a doomed document never gets there.
  private static readonly READ_STABILITY_MS = 2000;
  private stablyVisible = false;
  private stabilityTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.readQueue.pipe(
      bufferTime(400),
      filter((batch) => batch.length > 0),
      takeUntilDestroyed(),
    ).subscribe((batch) => {
      const unique = [...new Map(batch.map((m) => [m.id, m])).values()];
      this.messagesService.markManyAsRead(unique);
    });

    // Release deferred read receipts only once the app is stably foregrounded (see onMessageVisible).
    if (typeof document !== 'undefined') {
      fromEvent(document, 'visibilitychange').pipe(
        takeUntilDestroyed(),
      ).subscribe(() => {
        if (document.visibilityState === 'visible') {
          this.armReadStability();
        } else {
          this.cancelReadStability();
        }
      });
      // The component can mount already visible (a normal open), so start the settle timer now.
      if (document.visibilityState === 'visible') {
        this.armReadStability();
      }
    }

    // Opening a conversation reconciles its unread counter with the actual messages, healing any
    // stale badge left behind when a message ended up read without a matching counter decrement.
    effect(() => {
      const id = this.conversationId();
      if (id) {
        this.messagesService.reconcileUnreadCount(id);
      }
    });

    // Live presence/typing for the current 1:1 peer.
    this.hubService.presence.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e.userId === this.peerId()) {
        this.peerOnline.set(e.status === 'online');
        if (e.status === 'offline') {
          this.peerTyping.set(false);
        }
      }
    });
    this.hubService.typing.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e.userId === this.peerId()) {
        this.peerTyping.set(true);
        clearTimeout(this.typingClearTimer);
        this.typingClearTimer = setTimeout(() => this.peerTyping.set(false), 3000);
      }
    });

    // (Un)subscribe presence as the open conversation's peer changes (and on destroy).
    effect((onCleanup) => {
      const id = this.peerId();
      this.peerOnline.set(false);
      this.peerTyping.set(false);
      if (!id) {
        return;
      }
      this.hubService.subscribePresence(id);
      onCleanup(() => this.hubService.unsubscribePresence(id));
    });
  }

  messageText = signal<string>('');

  openChatDetails(event: Event) {
    // Drop focus from the header button so it isn't left in an active/focused
    (event.currentTarget as HTMLElement | null)?.blur();
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

  /** Throttled 'typing' signal to the hub while the user edits the message box. */
  onLocalTyping(): void {
    const now = Date.now();
    if (now - this.lastTypingSentAt > 2000) {
      this.lastTypingSentAt = now;
      this.hubService.sendTyping();
    }
  }

  async onPhotoSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file
    const convoId = this.conversationId();
    if (!file || !convoId) return;

    try {
      const dataUrl = await compressImageToDataUrl(file, PHOTO_OPTIONS);
      await this.messagesService.sendMessage(convoId, dataUrl, 'image');
    } catch (e) {
      console.error('Failed to send photo', e);
    }
  }

  onMessageVisible(msg: LocalMessage) {
    if (msg.isMine || msg.status === 'read') {
      return;
    }
    // Only acknowledge a read once the document has settled (visible for READ_STABILITY_MS). A
    // document backgrounded, or one iOS is about to replace on resume, never settles - so it never
    // fires a doomed receipt. Reads seen before then are held and flushed once stable.
    if (!this.stablyVisible) {
      this.pendingReads.set(msg.id, msg);
      return;
    }
    // Queue for a batched read receipt (see readQueue).
    this.readQueue.next(msg);
  }

  /** Mark the document stable after it stays visible for READ_STABILITY_MS, then flush held reads. */
  private armReadStability() {
    clearTimeout(this.stabilityTimer);
    this.stablyVisible = false;
    this.stabilityTimer = setTimeout(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        this.stablyVisible = true;
        this.flushPendingReads();
      }
    }, ChatComponent.READ_STABILITY_MS);
  }

  private cancelReadStability() {
    clearTimeout(this.stabilityTimer);
    this.stablyVisible = false;
  }

  private flushPendingReads() {
    if (this.pendingReads.size === 0) {
      return;
    }
    for (const msg of this.pendingReads.values()) {
      this.readQueue.next(msg);
    }
    this.pendingReads.clear();
  }

  messageAvatar(senderId: string): string | undefined {
    return this.profilesResource.value()?.[senderId]?.avatar;
  }

  messageSenderName(senderId: string): string | undefined {
    return this.profilesResource.value()?.[senderId]?.name;
  }

  /** Data URL of the image shown full-size in the lightbox, or undefined when closed. */
  previewImage = signal<string | undefined>(undefined);

  openImagePreview(src: string): void {
    this.previewImage.set(src);
  }

  closeImagePreview(): void {
    this.previewImage.set(undefined);
  }
}


