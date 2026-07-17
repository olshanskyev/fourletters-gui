import { Component, inject, resource, input, model, ChangeDetectionStrategy } from '@angular/core';
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
import { UsersList } from '@components/widgets/users-list';


@Component({
  selector: 'app-contacts',
  standalone: true,
  templateUrl: './contacts.component.html',
  styleUrls: ['./contacts.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ListLayoutComponent,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatDialogModule,
    UsersList
  ],
})
export class ContactsComponent {
  // Enables multi-select checkbox mode
  selectionMode = input(false);

  // Model containing the IDs of the selected contacts
  selectedContacts = model<string[]>([]);

  private readonly dialog = inject(MatDialog);

  private usersService = inject(UsersService);
  private masterViewService = inject(MasterViewService);
  contacts = resource({
    loader: () => this.usersService.getContactList(),
  });

  goBack() {
    this.masterViewService.setView('conversations');
  }

  openInviteDialog() {
    this.dialog.open(InviteDialogComponent, {
      panelClass: 'invite-dialog',
    });
  }
}
