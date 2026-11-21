import {
  Component, computed, effect, inject, input, linkedSignal, resource, signal,
  ChangeDetectionStrategy, ElementRef,
} from '@angular/core';
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
import { switchMap, of, Subject, bufferTime, filter, fromEvent, map } from 'rxjs';
import { SettingsService } from '@core/services/shared/settings.service';
import { LocalMessage } from '@core/services/messages/models/messages.model';
import { ObserveVisibilityDirective } from './observe-visibility.directive';
import { LinkifyPipe } from './linkify.pipe';
import { ConnectionStatus } from '../widgets/connection-status';
import { MessagesService } from '@core/services/messages/messages.service';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { UsersService } from '@core/services/users/users.service';
import { HubService } from '@core/services/messages/ws/hub.service';
import { MatMenuModule } from '@angular/material/menu';
import { compressImageToDataUrl } from '@core/utils/image-compression';
import { CallService } from '@core/services/calls/call.service';
import { CallMedia } from '@core/services/calls/models/call.model';
import { HotToastService } from '@ngxpert/hot-toast';
import { TranslateService } from '@ngx-translate/core';
import { callErrorKey } from '@components/call/call-utils';
import { CallLogPipe } from './call-log.pipe';
import { ChatStatusComponent } from './chat-status/chat-status.component';
import { MessageSelectDirective } from './reactions/message-select.directive';
import { MessageReactionsComponent } from './reactions/message-reactions/message-reactions.component';
import { ReactionPickerComponent } from './reactions/reaction-picker/reaction-picker.component';
import { environment } from '@env/environment';

interface DaySection {
  id: string;
  date: number;
  messages: LocalMessage[];
}

interface ImageSize {
  width: number; // display width in px
  aspectRatio: string;
}

interface MessagePage {
  messages: LocalMessage[];
  contents: Map<string, string>; // messageId -> decrypted text / image data URL
  imageSizes: Map<string, ImageSize>; // messageId -> display size of an image message
  limit: number;
  hasMore: boolean;
}

/** Number of messages loaded initially and added on each scroll-up. */
const PAGE_SIZE = 30;

/** Index (oldest first) of the loaded message whose visibility loads the next page. */
const LOAD_MORE_AHEAD = 5;

/** No scroll events for this long means the user's scroll (wheel animation, momentum) has ended. */
const SCROLL_IDLE_MS = 150;

/** Max displayed height of a chat image; also drives .message-image max-height in SCSS. */
const MAX_IMAGE_HEIGHT = 320;

/**
 * Explicit image size, because iOS 26 Safari can lay an <img> out at 0x0 and never re-layout it
 * once its intrinsic size becomes known.
 */
async function measureImage(src: string): Promise<ImageSize | undefined> {
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
  } catch {
    return undefined;
  }
  const { naturalWidth: w, naturalHeight: h } = img;
  if (!w || !h) {
    return undefined;
  }
  return { width: Math.round(w * Math.min(1, MAX_IMAGE_HEIGHT / h)), aspectRatio: `${w} / ${h}` };
}

/** Encoding preset for chat photos: a larger edge and single quality. */
const PHOTO_OPTIONS = {
  maxDimension: 1280,
  qualitySteps: [0.7],
};

/** Bytes reserved for the encryption envelope (headers, IV, signature, JSON) beyond base64. */
const PAYLOAD_ENVELOPE_RESERVE = 4096;

@Component({
  selector: 'app-chat',
  standalone: true,
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--message-image-max-height.px]': 'maxImageHeight' },
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
    LinkifyPipe,
    CallLogPipe,
    TranslateModule,
    MatMenuModule,
    ConnectionStatus,
    ChatStatusComponent,
    MessageSelectDirective,
    MessageReactionsComponent,
    ReactionPickerComponent,
  ],
})
export class ChatComponent {
  protected readonly maxImageHeight = MAX_IMAGE_HEIGHT;
  sidePanelService = inject(SidePanelService);
  messagesService = inject(MessagesService);
  private conversationsService = inject(ConversationsService);
  private usersService = inject(UsersService);
  private hubService = inject(HubService);
  private callService = inject(CallService);
  private toast = inject(HotToastService);
  private translate = inject(TranslateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly callActive = computed(() => !!this.callService.activeCall());
  conversationId = input<string | undefined>(undefined);
  showBackButton = input<boolean>(true);
  settingsService = inject(SettingsService);
  locale = this.settingsService.locale;
  // Resets to the first page whenever the conversation changes.
  private pageLimit = linkedSignal({ source: this.conversationId, computation: () => PAGE_SIZE });

  private page = toSignal(
    toObservable(computed(() => ({ id: this.conversationId(), limit: this.pageLimit() }))).pipe(
      switchMap(({ id, limit }) => id
        ? this.messagesService.observeMessages(id, limit).pipe(map((msgs) => ({ msgs, limit })))
        : of({ msgs: [] as LocalMessage[], limit })),
      // Decrypt and measure before rendering, so the list renders complete in one pass.
      switchMap(async ({ msgs, limit }): Promise<MessagePage> => {
        const decrypted = await this.decryptPage(msgs);
        if (limit > this.page().limit) {
          // An older page added during a running scroll (wheel animation, momentum) makes the
          // browser finish that scroll from a stale offset, jumping a whole page up.
          await this.scrollIdle();
        }
        return { messages: msgs, ...decrypted, limit, hasMore: msgs.length === limit };
      }),
    ),
    {
      initialValue: {
        messages: [], contents: new Map(), imageSizes: new Map(), limit: PAGE_SIZE, hasMore: false,
      },
    },
  );

  messages = computed(() => this.page().messages);
  contents = computed(() => this.page().contents);
  imageSizes = computed(() => this.page().imageSizes);
  hasMore = computed(() => this.page().hasMore);
  loadingMore = computed(() => this.page().limit !== this.pageLimit());
  canLoadMore = computed(() => this.hasMore() && !this.loadingMore());
  loadMoreTriggerId = computed(
    () => this.canLoadMore() ? this.messages()[LOAD_MORE_AHEAD]?.id : undefined,
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
    return view && view.id === this.conversationId() && view.kind === 'direct'
      ? view.participants[0] : undefined;
  });
  readonly groupId = computed(() => {
    const view = this.conversation.value();
    return view && view.id === this.conversationId() ? view.groupId : undefined;
  });
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
      const ids = this.messages().filter((msg) => !msg.isMine).map((msg) => msg.senderId);
      return [...new Set(ids)].sort();
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
  readonly connectionState = this.hubService.connectionState;

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
      this.lastTypingSentAt = 0;
      if (id) {
        this.messagesService.reconcileUnreadCount(id);
      }
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

  startCall(media: CallMedia): void {
    const convoId = this.conversationId();
    if (!convoId) return;
    this.callService.startCall(convoId, media)
      .catch(err => this.toast.error(this.translate.instant(callErrorKey(err))));
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
      this.hubService.sendTyping(this.peerId(), this.groupId());
    }
  }

  async onPhotoSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file
    const convoId = this.conversationId();
    if (!file || !convoId) return;

    try {
      // The encrypted payload is base64 (4/3 of the plaintext), so size the photo to fit the cap.
      const maxDataUrlLength = Math.floor(
        (environment.maxMessagePayloadBytes - PAYLOAD_ENVELOPE_RESERVE) * 3 / 4
      );
      const dataUrl = await compressImageToDataUrl(file, { ...PHOTO_OPTIONS, maxDataUrlLength });
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

  loadMore(): void {
    this.pageLimit.update((limit) => limit + PAGE_SIZE);
  }

  /** Resolves once the message list has had no scroll events for SCROLL_IDLE_MS. */
  private scrollIdle(): Promise<void> {
    const scroller = this.host.nativeElement.querySelector('.scroll-container');
    if (!scroller) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = (): void => {
        scroller.removeEventListener('scroll', restart);
        resolve();
      };
      let timer = setTimeout(done, SCROLL_IDLE_MS);
      const restart = (): void => {
        clearTimeout(timer);
        timer = setTimeout(done, SCROLL_IDLE_MS);
      };
      scroller.addEventListener('scroll', restart, { passive: true });
    });
  }

  /** Decrypts (and measures images) only for messages not already handled by the previous page. */
  private async decryptPage(
    msgs: LocalMessage[],
  ): Promise<Pick<MessagePage, 'contents' | 'imageSizes'>> {
    const previous = this.page();
    const contents = new Map<string, string>();
    const imageSizes = new Map<string, ImageSize>();
    await Promise.all(msgs.map(async (m) => {
      const content = previous.contents.get(m.id) ?? await this.decryptContent(m);
      contents.set(m.id, content);
      if (m.contentType === 'image' && content) {
        const size = previous.imageSizes.get(m.id) ?? await measureImage(content);
        if (size) {
          imageSizes.set(m.id, size);
        }
      }
    }));
    return { contents, imageSizes };
  }

  private async decryptContent(m: LocalMessage): Promise<string> {
    if (m.kind === 'system' || !m.text) {
      return '';
    }
    try {
      return await this.messagesService.decryptFromAtRest(m.id, m.text);
    } catch (e) {
      console.error('Failed to decrypt message in UI:', e);
      return '**(Encrypted)**';
    }
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


