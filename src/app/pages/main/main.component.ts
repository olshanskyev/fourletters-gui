import {
  Component,
  afterNextRender,
  effect,
  input,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, Location } from '@angular/common';
import { NavigationEnd, NavigationStart, Router, RouterModule } from '@angular/router';
import { filter } from 'rxjs';
import { SplitLayoutComponent } from '@layouts/split-layout/split-layout.component';
import { ChatComponent } from '@components/chat/chat.component';
import { ConversationsComponent } from '@components/conversations/conversations.component';
import { ContactsComponent } from '@components/contacts/contacts.component';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { AuthService } from '@core/services/authentication/auth.service';
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
  private readonly location = inject(Location);
  private readonly authService = inject(AuthService);
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

    afterNextRender(() => this.seedConversationsHistory());

    effect(() => {
      const inviteTargetId = this.inviteTargetId();
      if (inviteTargetId) {
        this.handleInvite(inviteTargetId);
      }
    });
  }

  /**
   * When the app cold-starts directly on a chat (e.g. opened from a push notification at
   * `/m/:id`), there is no `/m` entry behind it, so the back gesture would leave the app. Insert
   * a `/m` entry before the current one on that first load so back returns to the conversations
   * list.
   */
  private seedConversationsHistory(): void {
    const id = this.id();
    if (!id) {
      return;
    }
    this.location.replaceState('/m');
    this.location.go(`/m/${id}`);
  }

  private async handleInvite(inviteTargetId: string) {
    const currentUser = this.authService.currentUser();
    // Prevent opening a chat with oneself if necessary (or just let the service handle it)
    if (currentUser?.id !== inviteTargetId) {
      try {
        const conversationId =
          await this.conversationsService.ensureDirectConversation(inviteTargetId);
        // Redirect to the regular chat route
        this.router.navigate(['/m', conversationId], { replaceUrl: true });
      } catch (e) {
        console.error('Failed to create/open conversation from invite:', e);
        this.router.navigate(['/m'], { replaceUrl: true });
      }
    } else {
      // If it's your own invite link, just go back to main
      this.router.navigate(['/m'], { replaceUrl: true });
    }
  }
}
