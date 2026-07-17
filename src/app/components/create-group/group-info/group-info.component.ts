import {
  Component,
  inject,
  model,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { FormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { ListLayoutComponent } from '@layouts/list-layout/list-layout.component';
import { MasterViewService } from '@core/services/shared/master-view.service';
import { TextFieldModule } from '@angular/cdk/text-field';
import { AvatarPicker } from '@components/widgets/avatar-picker';

@Component({
  selector: 'app-group-info',
  standalone: true,
  templateUrl: './group-info.component.html',
  styleUrls: ['./group-info.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    ListLayoutComponent,
    TextFieldModule,
    AvatarPicker,
  ],
})
export class GroupInfoComponent {
  groupName = model<string>('');
  avatarUrl = model<string | undefined>(undefined);

  private masterViewService = inject(MasterViewService);

  goBack() {
    this.masterViewService.setView('conversations');
  }
}
