import { Injectable, inject } from '@angular/core';
import { ConversationsRepository } from './conversations.repository';
import { LocalConversation, ConversationView } from './models/conversations.model';
import { Observable } from 'rxjs';
import { UsersService } from '@core/services/users/users.service';
import { GroupsService } from '@core/services/groups/groups.service';
import { GroupsRepository } from '@core/services/groups/groups.repository';

@Injectable({
  providedIn: 'root'
})
export class ConversationsService {
  private repository = inject(ConversationsRepository);
  private usersService = inject(UsersService);
  private groupsService = inject(GroupsService);
  private groupsRepo = inject(GroupsRepository);

  /**
   * Observe all conversations as UI view-models, sorted by latest activity
   */
  observeConversationViews(): Observable<ConversationView[]> {
    return this.repository.observeConversationsProjected(conversations =>
      Promise.all(conversations.map(c => this.toView(c)))
    );
  }

  /**
   * Observe the total unread count across all conversations. Used to drive the app icon badge.
   */
  observeTotalUnread(): Observable<number> {
    return this.repository.observeConversationsProjected(conversations =>
      Promise.resolve(conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0))
    );
  }

  /**
   * Observe a single conversation's view-model by ID. Re-emits live when the conversation or its
   * cached profile/group metadata changes (e.g. a renamed contact), keeping the chat header current.
   */
  observeConversationView(id: string): Observable<ConversationView | undefined> {
    return this.repository.observeConversationProjected(id, conversation =>
      conversation ? this.toView(conversation) : Promise.resolve(undefined)
    );
  }

  /**
   * Get the raw stored conversation by ID (used by the send path to resolve routing).
   */
  async getConversation(id: string): Promise<LocalConversation | undefined> {
    return this.repository.getConversation(id);
  }

  /** One-shot resolve of a conversation's display view-model (title/avatar) by ID. */
  async getConversationView(id: string): Promise<ConversationView | undefined> {
    const conversation = await this.repository.getConversation(id);
    return conversation ? this.toView(conversation) : undefined;
  }

  /** Remove a conversation locally (e.g. after leaving a group). */
  async removeConversation(id: string): Promise<void> {
    await this.repository.deleteConversation(id);
  }

  /**
   * Find-or-create the thin direct conversation with a peer. Idempotent; no metadata fetch.
   */
  async ensureDirectConversation(peerId: string): Promise<string> {
    const existing = await this.findDirectConversationWith(peerId);
    if (existing) {
      return existing.id;
    }
    const conversation: LocalConversation = {
      id: crypto.randomUUID(),
      kind: 'direct',
      peerId,
      unreadCount: 0,
      updatedAt: Date.now()
    };
    await this.repository.putConversation(conversation);
    return conversation.id;
  }

  /**
   * Find-or-create the thin group conversation for a server-owned group. Idempotent; no metadata
   * fetch.
   */
  async ensureGroupConversation(groupId: string): Promise<string> {
    const existing = await this.findGroupConversation(groupId);
    if (existing) {
      return existing.id;
    }
    const conversation: LocalConversation = {
      id: crypto.randomUUID(),
      kind: 'group',
      groupId,
      unreadCount: 0,
      updatedAt: Date.now()
    };
    await this.repository.putConversation(conversation);
    return conversation.id;
  }

  /**
   * Update the latest message preview of a conversation and float it to the top.
   */
  async updateLastMessage(id: string, text: string, time: number): Promise<void> {
    const existing = await this.repository.getConversation(id);
    if (!existing) return;

    existing.lastMessageText = text;
    existing.lastMessageAt = time;
    existing.updatedAt = time; // Sort to top

    await this.repository.putConversation(existing);
  }

  async adjustUnreadCount(id: string, delta: number): Promise<void> {
    await this.repository.adjustUnreadCount(id, delta);
  }

  // ---- internal helpers ------------------------------------------------------------------

  /** The id of the direct conversation with a peer, if one exists. */
  async findDirectConversationId(peerId: string): Promise<string | undefined> {
    return (await this.findDirectConversationWith(peerId))?.id;
  }

  /**
   * Ids of group conversations whose locally cached roster includes a member. Local-only reads (no
   * server roster fetch), so it is safe to call on every contact key change.
   */
  async findGroupConversationIdsWithMember(userId: string): Promise<string[]> {
    const all = await this.repository.getAllConversations();
    const groups = all.filter(c => c.kind === 'group' && c.groupId);
    const ids: string[] = [];
    for (const c of groups) {
      const group = await this.groupsRepo.getGroup(c.groupId!);
      if (group?.members.includes(userId)) {
        ids.push(c.id);
      }
    }
    return ids;
  }

  private async findDirectConversationWith(peerId: string): Promise<LocalConversation | undefined> {
    const all = await this.repository.getAllConversations();
    return all.find(c => c.kind === 'direct' && c.peerId === peerId);
  }

  private async findGroupConversation(groupId: string): Promise<LocalConversation | undefined> {
    const all = await this.repository.getAllConversations();
    return all.find(c => c.kind === 'group' && c.groupId === groupId);
  }

  /**
   * Join a thin conversation with its resolved display metadata. Reads are cache-first: when a
   * profile/group isn't cached yet, a placeholder is shown while the background SWR refresh fetches
   * it — the resulting cache write re-triggers the live query, swapping in the real data.
   */
  private async toView(c: LocalConversation): Promise<ConversationView> {
    const base = {
      id: c.id,
      kind: c.kind,
      lastMessageText: c.lastMessageText,
      lastMessageAt: c.lastMessageAt,
      unreadCount: c.unreadCount
    };

    if (c.kind === 'group' && c.groupId) {
      const group = await this.groupsService.getGroup(c.groupId);
      return group
        ? { ...base, title: group.name, avatarUrl: group.avatarUrl, participants: group.members }
        : { ...base, title: 'Group', participants: [] };
    }

    if (c.kind === 'direct' && c.peerId) {
      const profile = await this.usersService.getProfile(c.peerId);
      return profile
        ? {
            ...base,
            title: profile.localName || profile.username || 'Unknown Contact',
            avatarUrl: profile.localAvatarUrl || profile.avatarUrl,
            participants: [c.peerId]
          }
        : { ...base, title: 'Unknown Contact', participants: [c.peerId] };
    }

    return { ...base, title: 'Unknown Contact', participants: [] };
  }
}
