import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
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

  // Automatically streams and sorts conversations from IndexedDB
  conversations = toSignal(this.conversationsService.observeConversationViews(), {
    initialValue: [],
  });

  newGroup() {
    this.masterViewService.setView('create-group');
  }

  newChat() {
    this.masterViewService.setView('contacts');
  }
}
