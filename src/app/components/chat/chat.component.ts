import { Component, OnInit, OnChanges, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatLayoutComponent } from '../../layouts/chat-layout/chat-layout.component';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { TextFieldModule } from '@angular/cdk/text-field';
import { SidePanelService } from '../../core/services/shared/side-panel.service';
import { ChatDetailsComponent } from './chat-details/chat-details.component';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HubService } from '../../core';

@Component({
  selector: 'app-chat',
  standalone: true,
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
  imports: [
    FormsModule,
    CommonModule,
    ChatLayoutComponent,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    TextFieldModule,
    MatIconModule,
    RouterLink,
  ]
})
export class ChatComponent implements OnInit, OnChanges {
  sidePanelService = inject(SidePanelService);
  hubService = inject(HubService);

  conversationId = input<string | undefined>(undefined);
  showBackButton = input<boolean>(true);

  messages: any[] = [];
  messageText = signal<string>('');

  // Static dummy data for demonstration
  private allMessages: Record<string, any[]> = {
    1: [
      { id: 1, text: 'Hello! first', isMine: false },
      { id: 2, text: 'Hi, how are you?', isMine: true },
    ],
    2: [
      //{ id: 1, text: 'Did you see the game?', isMine: false },
    ],
    3: [
      { id: 1, text: 'Meeting at 10 AM?', isMine: false },
      { id: 2, text: 'Yes, I will be there.', isMine: true },
      { id: 3, text: 'Hopefully', isMine: true },
      { id: 4, text: 'lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.', isMine: false },
      { id: 5, text: 'Yes, I will be there.', isMine: true },
      { id: 6, text: 'Lorem ipsum dolor, sit amet consectetur adipisicing elit. Voluptas impedit quae ducimus veniam ut autem eum nesciunt possimus qui laborum voluptatibus, eaque saepe ad aperiam laboriosam rem dolor quas asperiores commodi eius aliquam nostrum! Quidem velit enim, magni maxime numquam doloribus fugiat eveniet, porro commodi nesciunt delectus rem libero rerum.', isMine: true },
      { id: 7, text: 'Meeting at 10 AM?', isMine: false },
      { id: 8, text: 'Yes, I will be there.', isMine: true },
      { id: 9, text: 'Hopefully', isMine: true },
      { id: 10, text: 'Meeting at 10 AM?', isMine: false },
      { id: 11, text: 'Yes, I will be there.', isMine: true },
      { id: 12, text: 'Hopefully', isMine: true },
      { id: 13, text: 'Meeting at 10 AM?', isMine: false },
      { id: 14, text: 'Yes, I will be there.', isMine: true },
      { id: 15, text: 'Hopefully', isMine: true },
      { id: 16, text: 'Meeting at 10 AM?', isMine: false },
      { id: 17, text: 'Yes, I will be there.', isMine: true },
      { id: 18, text: 'Hopefully Last', isMine: true },
    ]
  };

  ngOnInit() {
    this.loadMessages();
  }

  ngOnChanges() {
    this.loadMessages();
  }

  private loadMessages() {
    if (this.conversationId()) {
      this.messages = (this.allMessages[this.conversationId()!] || []);
    } else {
      this.messages = [];
    }
  }

  openChatDetails() {
    this.sidePanelService.open(ChatDetailsComponent);
  }
  sendMessage() {
    this.hubService.sendMessage('4723d731-cfef-47d2-8a5a-f039552c7601', this.messageText());
  }
}