import { Component, inject, ChangeDetectionStrategy, input, resource, computed, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { CommonModule } from '@angular/common';
import { ProfileLayoutComponent } from '@layouts/profile-layout/profile-layout.component';
import { SidePanelService } from '@core/services/shared/side-panel.service';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { GroupsService } from '@core/services/groups/groups.service';
import { UsersService } from '@core/services/users/users.service';
import { ConversationView } from '@core/services/conversations/models/conversations.model';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { AuthService } from '@core/services/authentication/auth.service';
import { MatTabsModule } from '@angular/material/tabs';
import { UsersList } from '@components/widgets/users-list';
import { AvatarPicker } from '@components/widgets/avatar-picker';

@Component({
  selector: 'app-chat-details',
  standalone: true,
  templateUrl: './chat-details.component.html',
  styleUrls: ['./chat-details.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ProfileLayoutComponent,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatTabsModule,
    UsersList,
    AvatarPicker
  ],
})
export class ChatDetailsComponent {
  private readonly sidePanelService = inject(SidePanelService);
  private readonly conversationService = inject(ConversationsService);
  private readonly groupsService = inject(GroupsService);
  private readonly usersService = inject(UsersService);
  private readonly authService = inject(AuthService);

  conversationView = input<ConversationView | undefined>(undefined);

  isGroupConversation = computed(() => this.conversationView()?.kind === 'group');

  // Gate the tab UI until the conversation kind is known.
  isInitialized = computed(() => !!this.conversationView());

  private localConversation = resource({
    params: () => this.conversationView()?.id,
    loader: ({ params: id }) =>
      id ? this.conversationService.getConversation(id) : Promise.resolve(undefined),
  });

  // Cache-first: stream the locally cached group so members render immediately, while a background
  // refresh updates the roster and re-emits through the live query.
  groupResource = rxResource({
    params: () =>
      this.isGroupConversation() ? this.localConversation.value()?.groupId : undefined,
    stream: ({ params: groupId }) =>
      groupId ? this.groupsService.fetchAndObserveGroup(groupId) : of(undefined),
  });

  isGroupAdmin = computed(() => this.isGroupConversation() &&
    this.authService.currentUser() &&
    this.authService.currentUser()!.id === this.groupResource.value()?.ownerId);

  // Stable roster key: value-based equality so a group re-emit with an unchanged roster (e.g. the
  // background refresh rewriting `updatedAt`) doesn't rebuild the members stream or refetch profiles.
  private memberIds = computed(
    () => (this.isGroupConversation() ? (this.groupResource.value()?.members ?? []) : []),
    { equal: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) },
  );

  membersProfilesResource = rxResource({
    params: () => this.memberIds(),
    stream: ({ params: memberIds }) => this.usersService.getAndObserveProfiles(memberIds),
  });

  userResource = rxResource({
    params: () => (this.isGroupConversation() ? undefined : this.localConversation.value()?.peerId),
    stream: ({ params: peerId }) =>
      peerId ? this.usersService.fetchAndObserveProfile(peerId) : of(undefined),
  });

  // Direct chats always allow a local avatar override; group avatars are owner-only.
  canEditAvatar = computed(() => (this.isGroupConversation() ? !!this.isGroupAdmin() : true));

  // Only a group owner may rename the group.
  canEditName = computed(() => this.isGroupConversation() && !!this.isGroupAdmin());

  // Live title: prefer the group's up-to-date name over the conversation snapshot.
  title = computed(() => {
    if (this.isGroupConversation()) {
      return this.groupResource.value()?.name ?? this.conversationView()?.title;
    }
    return this.conversationView()?.title;
  });

  isEditingName = signal(false);
  nameError = signal<string | undefined>(undefined);

  avatarUrl = computed(() => {
    if (this.isGroupConversation()) {
      return this.groupResource.value()?.avatarUrl ?? this.conversationView()?.avatarUrl;
    }
    const profile = this.userResource.value();
    return profile?.localAvatarUrl ?? profile?.avatarUrl ?? this.conversationView()?.avatarUrl;
  });

  avatarError = signal<string | undefined>(undefined);

  async onAvatarSelected(dataUrl: string): Promise<void> {
    this.avatarError.set(undefined);
    try {
      if (this.isGroupConversation()) {
        const groupId = this.localConversation.value()?.groupId;
        if (groupId) {
          await this.groupsService.updateAvatar(groupId, dataUrl);
        }
      } else {
        const peerId = this.localConversation.value()?.peerId;
        if (peerId) {
          await this.usersService.setLocalAvatar(peerId, dataUrl);
        }
      }
    } catch (e) {
      this.avatarError.set(e instanceof Error ? e.message : 'Failed to update the picture.');
    }
  }

  close() {
    this.sidePanelService.close();
  }

  startEditName(): void {
    this.nameError.set(undefined);
    this.isEditingName.set(true);
  }

  cancelEditName(): void {
    this.isEditingName.set(false);
    this.nameError.set(undefined);
  }

  async saveName(value: string): Promise<void> {
    const name = value.trim();
    if (!name) {
      this.nameError.set('Name must not be blank.');
      return;
    }
    if (name === this.title()) {
      this.isEditingName.set(false);
      return;
    }
    const groupId = this.localConversation.value()?.groupId;
    if (!groupId) {
      return;
    }
    this.nameError.set(undefined);
    try {
      await this.groupsService.updateName(groupId, name);
      this.isEditingName.set(false);
    } catch (e) {
      this.nameError.set(e instanceof Error ? e.message : 'Failed to rename the group.');
    }
  }
}
