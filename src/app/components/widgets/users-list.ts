import { Component, ChangeDetectionStrategy, input, model, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { CommonModule } from '@angular/common';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { UserProfileRecord } from '@core/services/database/app.database';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { MasterViewService } from '@core/services/shared/master-view.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-users-list',
  template: `
    @for (profile of userProfiles() || []; track profile.id) {
      <div class="d-flex align-items-center p-x-16 p-y-4 profile-item cursor-pointer"
           (click)="handleClickOnUser(profile.id)"
           (keyup.enter)="handleClickOnUser(profile.id)"
           tabindex="0">
        @if (selectionMode()) {
          <mat-checkbox
            [checked]="selectedProfiles().includes(profile.id)"
            (change)="toggleSelection(profile.id)"
            (click)="$event.stopPropagation()"
            class="m-r-16" />
        }
        @if (profile.localAvatarUrl || profile.avatarUrl) {
            <img [src]="profile.localAvatarUrl || profile.avatarUrl" class="avatar" alt="avatar" referrerpolicy="no-referrer" />
        } @else {
            <div class="avatar default-avatar"></div>
        }
        <div class="d-flex flex-col m-l-16">
          <span>{{ profile.localName || profile.username }}</span>
        </div>
      </div>
      } @empty {
      <div class="p-16 text-center text-color-second">
        Not found.
      </div>
      }
  `,
  styles: `
    .profile-item {
        border-radius: 8px;
        transition: background-color 0.2s ease;

        &:hover {
            background-color: var(--mat-sys-surface-container-high);
        }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule
  ],
})
export class UsersList {
    private readonly conversationsService = inject(ConversationsService);
    private readonly masterViewService = inject(MasterViewService);
    private readonly router = inject(Router);

    selectionMode = input(false);
    userProfiles = input<UserProfileRecord[]>([]);

    selectedProfiles = model<string[]>([]);

    async handleClickOnUser(userId: string) {
        if (this.selectionMode()) {
            this.toggleSelection(userId);
        } else {
            await this.openChat(userId);
        }
    }

    toggleSelection(userId: string) {
        const current = this.selectedProfiles();
        if (current.includes(userId)) {
            this.selectedProfiles.set(current.filter((id) => id !== userId));
        } else {
            this.selectedProfiles.set([...current, userId]);
        }
    }

    async openChat(userId: string) {
        try {
            const conversationId = await this.conversationsService.ensureDirectConversation(userId);
            this.router.navigate(['/m', conversationId]);
            // Optional: switch back to conversations view when navigating to chat.
            this.masterViewService.setView('conversations');
        } catch (e) {
            console.error('Failed to open chat with contact', e);
        }
    }
}