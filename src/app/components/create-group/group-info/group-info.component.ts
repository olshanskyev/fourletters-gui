import { Component, inject, resource, input, model, signal } from '@angular/core';
import { CommonModule } from '@angular/common';


import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { FormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { ListLayoutComponent } from '@layouts/list-layout/list-layout.component';
import { MasterViewService } from '@core/services/shared/master-view.service';
import { TextFieldModule } from '@angular/cdk/text-field';

@Component({
  selector: 'app-group-info',
  standalone: true,
  templateUrl: './group-info.component.html',
  styleUrls: ['./group-info.component.scss'],
  imports: [
    FormsModule,
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    ListLayoutComponent,
    TextFieldModule
  ]
})
export class GroupInfoComponent {

  groupName = model<string>('');

  private masterViewService = inject(MasterViewService);

  goBack() {
    this.masterViewService.setView('conversations');
  }
}
