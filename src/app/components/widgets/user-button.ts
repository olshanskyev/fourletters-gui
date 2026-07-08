import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

import { MatDividerModule } from '@angular/material/divider';
import { AuthService } from '@core/services/authentication/auth.service';
import { MasterViewService } from '@core/services/shared/master-view.service';
import { InviteDialogComponent } from '../dialogs/invite-dialog/invite-dialog.component';

@Component({
  selector: 'app-user-button',
  template: `
    <button
      matIconButton
      [matMenuTriggerFor]="menu"
      class="d-flex align-items-center justify-content-center"
    >
      @if (user()?.avatarUrl) {
        <img
          [src]="user()!.avatarUrl"
          class="avatar -small"
          alt="avatar"
          referrerpolicy="no-referrer"
        />
      } @else {
        <div class="avatar -small default-avatar"></div>
      }
    </button>

    <mat-menu #menu="matMenu">
      @if (user()?.username) {
        <button mat-menu-item disabled>
          <span>{{ user()?.username }}</span>
        </button>
        <mat-divider />
      }
      <button mat-menu-item (click)="openContacts()">
        <mat-icon>person</mat-icon>
        <span>Contacts</span>
      </button>
      <button mat-menu-item (click)="openInviteDialog()">
        <mat-icon>person_add</mat-icon>
        <span>Invite friends</span>
      </button>
      <button mat-menu-item (click)="logout()">
        <mat-icon>exit_to_app</mat-icon>
        <span>{{ 'logout' | translate }}</span>
      </button>
    </mat-menu>
  `,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    TranslateModule,
    MatDividerModule,
    MatDialogModule,
  ],
})
export class UserButton {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly masterViewService = inject(MasterViewService);

  user = this.auth.currentUser;

  openContacts() {
    this.masterViewService.setView('contacts');
  }

  openInviteDialog() {
    this.dialog.open(InviteDialogComponent, {
      panelClass: 'invite-dialog',
    });
  }

  logout() {
    this.auth.logout().subscribe(() => {
      this.router.navigateByUrl('/');
    });
  }
}
