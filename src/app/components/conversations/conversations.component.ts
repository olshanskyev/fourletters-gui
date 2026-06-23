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
    //this.conversationsService.createConversation('NAME', 'direct', ['3bc7f503-e4d7-4edc-998f-cfa5e38cf986']);
  }
}