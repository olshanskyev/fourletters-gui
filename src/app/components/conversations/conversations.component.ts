import { Component, inject } from '@angular/core';
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

@Component({
  selector: 'app-conversations',
  standalone: true,
  templateUrl: './conversations.component.html',
  styleUrls: ['./conversations.component.scss'],
  imports: [
    CommonModule,
    RouterModule,
    ListLayoutComponent,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    UserButton
  ]
})
export class ConversationsComponent {
  private conversationsService = inject(ConversationsService);

  // Automatically streams and sorts conversations from IndexedDB!
  conversations = toSignal(this.conversationsService.observeConversations(), { initialValue: [] });

  constructor() {
    //ToDo why called twice on startup? (once for each route)
    //console.log('ConversationsComponent constructor');
    //this.conversationsService.createConversation('NAME', 'direct', ['8698437b-3b73-4a7b-80fb-a9d6f0528617']);
  }
}