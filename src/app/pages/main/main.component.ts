import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SplitLayoutComponent } from '../../layouts/split-layout/split-layout.component';
import { ChatComponent } from '../../components/chat/chat.component';
import { ConversationsComponent } from '../../components/conversations/conversations.component';

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
export class MainComponent {
  @Input() id?: string; // Captures :id from the route
}