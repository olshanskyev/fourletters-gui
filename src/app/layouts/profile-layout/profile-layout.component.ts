import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-profile-layout',
  standalone: true,
  templateUrl: './profile-layout.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./profile-layout.component.scss'],
})
export class ProfileLayoutComponent {}
