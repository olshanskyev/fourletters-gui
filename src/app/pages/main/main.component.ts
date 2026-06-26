import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { SplitLayoutComponent } from '@layouts/split-layout/split-layout.component';
import { ChatComponent } from '@components/chat/chat.component';
import { ConversationsComponent } from '@components/conversations/conversations.component';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { AuthService } from '@core/services/authentication/auth.service';

@Component({
  selector: 'app-main',
  standalone: true,
  templateUrl: './main.component.html',
  styleUrls: ['./main.component.scss'],
  imports: [
    CommonModule,
    RouterModule,
    SplitLayoutComponent,
    ChatComponent,
    ConversationsComponent
]
})
export class MainComponent implements OnInit {
  @Input() id?: string; // Captures :id from the route
  @Input() inviteTargetId?: string; // Captures :inviteTargetId from the route

  private readonly conversationsService = inject(ConversationsService);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);

  async ngOnInit() {
    if (this.inviteTargetId) {
      const currentUser = this.authService.currentUser();
      // Prevent opening a chat with oneself if necessary (or just let the service handle it)
      if (currentUser?.id !== this.inviteTargetId) {
        try {
          const conversationId = await this.conversationsService
            .ensureDirectConversation(this.inviteTargetId);
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
}