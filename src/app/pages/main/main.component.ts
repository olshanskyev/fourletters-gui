import {
  Component,
  effect,
  input,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { NavigationEnd, NavigationStart, Router, RouterModule } from '@angular/router';
import { filter } from 'rxjs';
import { SplitLayoutComponent } from '@layouts/split-layout/split-layout.component';
import { ChatComponent } from '@components/chat/chat.component';
import { ConversationsComponent } from '@components/conversations/conversations.component';
import { ContactsComponent } from '@components/contacts/contacts.component';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { AuthService } from '@core/services/authentication/auth.service';
import { UsersService } from '@core/services/users/users.service';
import { MasterViewService } from '@core/services/shared/master-view.service';
import { CreateGroupComponent } from '@components/create-group/create-group.component';

@Component({
  selector: 'app-main',
  standalone: true,
  templateUrl: './main.component.html',
  styleUrls: ['./main.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    SplitLayoutComponent,
    ChatComponent,
    ConversationsComponent,
    ContactsComponent,
    CreateGroupComponent,
  ],
})
export class MainComponent {
  readonly id = input<string>(); // Captures :id from the route
  readonly inviteTargetId = input<string>(); // Captures :inviteTargetId from the route
  readonly notifyKind = input<string>(); // 'sender' | 'group' from the notification deep link
  readonly notifyId = input<string>(); // sender/group id from the notification deep link

  private readonly conversationsService = inject(ConversationsService);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly usersService = inject(UsersService);
  readonly masterViewService = inject(MasterViewService);

  /**
   * Suppresses the master/detail slide transition when navigation is driven by the browser/OS
   * back gesture (popstate)
   */
  readonly suppressAnimation = signal(false);

  constructor() {
    this.router.events
      .pipe(
        filter(
          (event): event is NavigationStart | NavigationEnd =>
            event instanceof NavigationStart || event instanceof NavigationEnd,
        ),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        if (event instanceof NavigationStart) {
          if (event.navigationTrigger === 'popstate') {
            this.suppressAnimation.set(true);
          }
        } else if (this.suppressAnimation()) {
          requestAnimationFrame(() =>
            requestAnimationFrame(() => this.suppressAnimation.set(false)),
          );
        }
      });

    effect(() => {
      const inviteTargetId = this.inviteTargetId();
      if (inviteTargetId) {
        this.handleInvite(inviteTargetId);
      }
    });

    effect(() => {
      const kind = this.notifyKind();
      const refId = this.notifyId();
      if (kind && refId) {
        this.handleNotify(kind, refId);
      }
    });
  }

  private async handleNotify(kind: string, refId: string) {
    try {
      // The guard on /m has already restored the session (so the local DB is ready). Resolve the
      // server-known sender/group to the local conversation.
      const conversationId =
        kind === 'group'
          ? await this.conversationsService.ensureGroupConversation(refId)
          : await this.conversationsService.ensureDirectConversation(refId);
      // Replace the transient notify URL with the conversations list, then push the chat on top
      await this.router.navigate(['/m'], { replaceUrl: true });
      await this.router.navigate(['/m', conversationId]);
    } catch (e) {
      console.error('Failed to open conversation from notification:', e);
      this.router.navigate(['/m'], { replaceUrl: true });
    }
  }

  private async handleInvite(inviteTargetId: string) {
    const currentUser = this.authService.currentUser();
    // If it's your own invite link, just go back to main
    if (currentUser?.id === inviteTargetId) {
      this.router.navigate(['/m'], { replaceUrl: true });
      return;
    }

    try {
      // Verify the invited user is registered before creating a conversation
      const profile = await this.usersService.lookupUser(inviteTargetId);
      if (!profile) {
        this.router.navigate(['/m'], { replaceUrl: true });
        return;
      }
      await this.usersService.cacheProfile(profile);
      const conversationId =
        await this.conversationsService.ensureDirectConversation(inviteTargetId);
      // Replace the invite URL with the conversations list, then push the chat on top
      await this.router.navigate(['/m'], { replaceUrl: true });
      await this.router.navigate(['/m', conversationId]);
    } catch (e) {
      console.error('Failed to create/open conversation from invite:', e);
      this.router.navigate(['/m'], { replaceUrl: true });
    }
  }
}
