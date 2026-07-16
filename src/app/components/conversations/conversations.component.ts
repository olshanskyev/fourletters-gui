import { Component, inject, ChangeDetectionStrategy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { ListLayoutComponent } from '@layouts/list-layout/list-layout.component';
import { UserButton } from '../widgets/user-button';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MasterViewService } from '@core/services/shared/master-view.service';
import { PushService } from '@core/services/push/push.service';
import { SettingsService } from '@core/services/shared/settings.service';

@Component({
  selector: 'app-conversations',
  standalone: true,
  templateUrl: './conversations.component.html',
  styleUrls: ['./conversations.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    ListLayoutComponent,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    UserButton,
    MatMenuModule,
    MatDividerModule,
  ],
})
export class ConversationsComponent {
  private conversationsService = inject(ConversationsService);
  private masterViewService = inject(MasterViewService);
  private pushService = inject(PushService);
  locale = inject(SettingsService).locale;

  // Automatically streams and sorts conversations from IndexedDB
  conversations = toSignal(this.conversationsService.observeConversationViews(), {
    initialValue: [],
  });

  // Controls the "Enable notifications" banner shown when permission is still undecided.
  showNotificationsBanner = this.pushService.showEnableBanner;

  enableNotifications() {
    this.pushService.enable();
  }

  dismissNotificationsBanner() {
    this.pushService.dismissBanner();
  }

  newGroup() {
    this.masterViewService.setView('create-group');
  }

  newChat() {
    this.masterViewService.setView('contacts');
  }

  constructor() {
    effect(() => {
      console.log('ConversationsComponent: conversations changed', this.conversations());
    });
  }
}
