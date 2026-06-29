import { Component, inject, resource, input, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';

import { ListLayoutComponent } from '@layouts/list-layout/list-layout.component';
import { UsersService } from '@core/services/users/users.service';
import { MasterViewService } from '@core/services/shared/master-view.service';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { InviteDialogComponent } from '@components/dialogs/invite-dialog/invite-dialog.component';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

@Component({
  selector: 'app-contacts',
  standalone: true,
  templateUrl: './contacts.component.html',
  styleUrls: ['./contacts.component.scss'],
  imports: [
    CommonModule,
    ListLayoutComponent,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatDialogModule
  ]
})
export class ContactsComponent {
  // Enables multi-select checkbox mode
  selectionMode = input(false);

  // Model containing the IDs of the selected contacts
  selectedContacts = model<string[]>([]);

  private readonly dialog = inject(MatDialog);

  private usersService = inject(UsersService);
  private conversationsService = inject(ConversationsService);
  private masterViewService = inject(MasterViewService);
  private router = inject(Router);
  contacts = resource({
    loader: () => this.usersService.getContactList()
  });

  goBack() {
    this.masterViewService.setView('conversations');
  }

  openInviteDialog() {
      this.dialog.open(InviteDialogComponent, {
        panelClass: 'invite-dialog'
      });
    }

  async handleContactClick(userId: string) {
    if (this.selectionMode()) {
      this.toggleSelection(userId);
    } else {
      await this.openChat(userId);
    }
  }

  toggleSelection(userId: string) {
    const current = this.selectedContacts();
    if (current.includes(userId)) {
      this.selectedContacts.set(current.filter(id => id !== userId));
    } else {
      this.selectedContacts.set([...current, userId]);
    }
  }

  async openChat(userId: string) {
    try {
      const conversationId = await this.conversationsService.ensureDirectConversation(userId);
      this.router.navigate(['/m', conversationId]);
      // Optional: switch back to conversations view when navigating to chat.
      this.masterViewService.setView('conversations');
    } catch (e) {
      console.error('Failed to open chat with contact', e);
    }
  }
}
