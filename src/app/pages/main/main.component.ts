import { Component, effect, input, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
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
  private readonly authService = inject(AuthService);
  readonly masterViewService = inject(MasterViewService);

  constructor() {
    effect(() => {
      const inviteTargetId = this.inviteTargetId();
      if (inviteTargetId) {
        this.handleInvite(inviteTargetId);
      }
    });
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
