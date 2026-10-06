import { Component, computed, effect, inject, input, resource, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '@core/services/authentication/auth.service';
import { HubService } from '@core/services/messages/ws/hub.service';
import { UsersService } from '@core/services/users/users.service';

@Component({
  selector: 'app-chat-status',
  imports: [TranslateModule],
  templateUrl: './chat-status.component.html',
  styleUrl: './chat-status.component.scss',
})
export class ChatStatusComponent {
  readonly peerId = input<string>();
  readonly groupId = input<string>();

  private readonly hub = inject(HubService);
  private readonly auth = inject(AuthService);
  private readonly users = inject(UsersService);
  readonly online = signal(false);
  readonly typingUserId = signal<string | undefined>(undefined);
  private typingTimer?: ReturnType<typeof setTimeout>;

  private readonly typingProfile = resource({
    params: () => this.groupId() ? this.typingUserId() : undefined,
    loader: ({ params: userId }) => this.users.getProfile(userId),
  });
  readonly typingName = computed(() => {
    const profile = this.typingProfile.hasValue() ? this.typingProfile.value() : undefined;
    return profile?.localName || profile?.username;
  });

  constructor() {
    this.hub.presence.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event.userId === this.peerId()) {
        this.online.set(event.status === 'online');
        if (event.status === 'offline') this.clearTyping();
      }
    });
    this.hub.typing.pipe(takeUntilDestroyed()).subscribe((event) => {
      const matches = event.groupId
        ? event.groupId === this.groupId()
        : event.userId === this.peerId();
      if (!matches || event.userId === this.auth.currentUser()?.id
        || this.hub.connectionState() !== 'connected') return;

      this.clearTyping();
      this.typingUserId.set(event.userId);
      this.typingTimer = setTimeout(() => this.clearTyping(), 3000);
    });

    effect((onCleanup) => {
      const peer = this.peerId();
      const group = this.groupId();
      this.online.set(false);
      this.clearTyping();
      if (peer) this.hub.subscribePresence(peer);
      else if (group) this.hub.subscribeGroupTyping(group);

      onCleanup(() => {
        this.clearTyping();
        if (peer) this.hub.unsubscribePresence(peer);
        else if (group) this.hub.unsubscribeGroupTyping(group);
      });
    });
    effect(() => {
      if (this.hub.connectionState() !== 'connected') {
        this.online.set(false);
        this.clearTyping();
      }
    });
  }

  private clearTyping(): void {
    clearTimeout(this.typingTimer);
    this.typingTimer = undefined;
    this.typingUserId.set(undefined);
  }
}