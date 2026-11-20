import { Component, computed, inject, input, resource } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '@core/services/authentication/auth.service';
import { UsersService } from '@core/services/users/users.service';
import { LocalMessage } from '@core/services/messages/models/messages.model';

interface ReactionGroup {
  emoji: string;
  reactorIds: string[]; // most recent first
  mine: boolean;
  firstTs: number;
}

interface Reactor {
  avatar?: string;
  name?: string;
}

/** Max avatars shown per chip; the rest is summarized as "+N". */
const MAX_AVATARS = 3;

/** Telegram-style reaction chips: emoji + stacked reactor avatars. */
@Component({
  selector: 'app-message-reactions',
  imports: [MatTooltipModule],
  templateUrl: './message-reactions.component.html',
  styleUrl: './message-reactions.component.scss',
})
export class MessageReactionsComponent {
  readonly message = input.required<LocalMessage>();

  private readonly auth = inject(AuthService);
  private readonly users = inject(UsersService);
  protected readonly maxAvatars = MAX_AVATARS;

  readonly groups = computed<ReactionGroup[]>(() => {
    const myId = this.auth.currentUser()?.id;
    const byEmoji = new Map<string, { id: string; ts: number }[]>();
    for (const [id, { emoji, ts }] of Object.entries(this.message().reactions ?? {})) {
      if (emoji) {
        byEmoji.set(emoji, [...(byEmoji.get(emoji) ?? []), { id, ts }]);
      }
    }
    return [...byEmoji.entries()]
      .map(([emoji, reactors]) => {
        const sorted = reactors.slice().sort((a, b) => b.ts - a.ts);
        return {
          emoji,
          reactorIds: sorted.map((r) => r.id),
          mine: sorted.some((r) => r.id === myId),
          firstTs: sorted[sorted.length - 1].ts,
        };
      })
      .sort((a, b) => b.reactorIds.length - a.reactorIds.length || a.firstTs - b.firstTs);
  });

  private readonly reactorIds = computed(
    () => [...new Set(this.groups().flatMap((g) => g.reactorIds))].sort(),
    { equal: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) },
  );

  private readonly reactors = resource({
    params: () => this.reactorIds().length ? this.reactorIds() : undefined,
    loader: async ({ params: ids }) => {
      const me = this.auth.currentUser();
      const entries = await Promise.all(ids.map(async (id): Promise<[string, Reactor]> => {
        if (id === me?.id) {
          return [id, { avatar: me.avatarUrl, name: me.username }];
        }
        const profile = await this.users.getProfile(id).catch(() => undefined);
        return [id, {
          avatar: profile?.localAvatarUrl || profile?.avatarUrl,
          name: profile?.localName || profile?.username,
        }];
      }));
      return new Map(entries);
    },
  });

  reactor(id: string): Reactor | undefined {
    return this.reactors.hasValue() ? this.reactors.value().get(id) : undefined;
  }

  names(group: ReactionGroup): string {
    return group.reactorIds.map((id) => this.reactor(id)?.name).filter(Boolean).join(', ');
  }
}
