import {
  Component,
  inject,
  resource,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { UsersService } from '@core/services/users/users.service';
import { MasterViewService } from '@core/services/shared/master-view.service';
import { ContactsComponent } from '@components/contacts/contacts.component';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { GroupInfoComponent } from './group-info/group-info.component';
import { GroupsService } from '@core/services/groups/groups.service';
import { ConversationsService } from '@core/services/conversations/conversations.service';

@Component({
  selector: 'app-create-group',
  standalone: true,
  templateUrl: './create-group.component.html',
  styleUrls: ['./create-group.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ContactsComponent, GroupInfoComponent, MatButtonModule, MatIconModule],
})
export class CreateGroupComponent {
  // Model containing the IDs of the selected contacts
  invitedUsers = signal<string[]>([]);
  groupName = signal<string>('');
  step = signal<'contacts' | 'groupInfo'>('contacts');

  private usersService = inject(UsersService);
  private masterViewService = inject(MasterViewService);
  private readonly groupsService = inject(GroupsService);
  private readonly conversationsService = inject(ConversationsService);

  contacts = resource({
    loader: () => this.usersService.getContactList(),
  });

  goBack() {
    this.masterViewService.setView('conversations');
  }

  createGroup() {
    void this.submitGroup();
  }

  private async submitGroup(): Promise<void> {
    const group = await this.groupsService.createGroup(this.groupName(), this.invitedUsers());
    await this.conversationsService.ensureGroupConversation(group.id);
    this.masterViewService.setView('conversations');
  }
}
