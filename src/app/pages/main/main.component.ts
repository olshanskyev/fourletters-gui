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
      // Redirect to the regular chat route
      this.router.navigate(['/m', conversationId], { replaceUrl: true });
    } catch (e) {
      console.error('Failed to create/open conversation from invite:', e);
      this.router.navigate(['/m'], { replaceUrl: true });
    }
  }
}
