import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { ListLayoutComponent } from '../../layouts/list-layout/list-layout.component';
import { UserButton } from '../widgets/user-button';


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

  conversations = [
    { id: '1', name: 'Alice', lastMessage: 'Hi, how are you?' },
    { id: '2', name: 'Bob', lastMessage: 'Did you see the game?' },
    { id: '3', name: 'Charlie', lastMessage: 'Meeting at 10 AM?' },
    { id: '4', name: 'Alice', lastMessage: 'Hi, how are you?' },
    { id: '5', name: 'Bob', lastMessage: 'Did you see the game?' },
    { id: '6', name: 'Charlie', lastMessage: 'Meeting at 10 AM?' },
    { id: '7', name: 'Alice', lastMessage: 'Hi, how are you?' },
    { id: '8', name: 'Bob', lastMessage: 'Did you see the game?' },
    { id: '9', name: 'Charlie', lastMessage: 'Meeting at 10 AM?' },
    { id: '10', name: 'Bob', lastMessage: 'Did you see the game?' },
    { id: '11', name: 'Charlie', lastMessage: 'Meeting at 10 AM?' },
    { id: '12', name: 'Alice', lastMessage: 'Hi, how are you?' },
    { id: '13', name: 'Bob', lastMessage: 'Did you see the game?' },
    { id: '14', name: 'Charlie', lastMessage: 'Meeting at 10 AM?' }

  ];
}