import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProfileLayoutComponent } from '@layouts/profile-layout/profile-layout.component';
import { SidePanelService } from '@core/services/shared/side-panel.service';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-chat-details',
  standalone: true,
  templateUrl: './chat-details.component.html',
  styleUrls: ['./chat-details.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ProfileLayoutComponent, MatButtonModule, MatIconModule],
})
export class ChatDetailsComponent {
  sidePanelService = inject(SidePanelService);

  close() {
    this.sidePanelService.close();
  }
}
