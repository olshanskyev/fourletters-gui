import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

import { MatDividerModule } from '@angular/material/divider';
import { AuthService } from '@core/services/authentication/auth.service';
import { InviteDialogComponent } from '../dialogs/invite-dialog/invite-dialog.component';

@Component({
  selector: 'app-user-button',
  template: `
    <button matIconButton [matMenuTriggerFor]="menu" class="user-button">
      <img [src]="user()?.avatarUrl" width="24" alt="avatar" referrerpolicy="no-referrer" />
    </button>

    <mat-menu #menu="matMenu">
      @if (user()?.username) {
        <button mat-menu-item disabled>
          <span>{{ user()?.username }}</span>
        </button>
        <mat-divider/>
      }
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
  styles: `
    .user-button {
        width: 48px !important;
        height: 48px !important;
        padding: 0 !important;
        display: flex;
        align-items: center;
        justify-content: center;

        img {
          width: 2rem;
          height: 2rem;
          border-radius: 50%;
        }
    }
  `,
  imports: [MatButtonModule, MatIconModule,
    MatMenuModule, TranslateModule, MatDividerModule, MatDialogModule],
})
export class UserButton {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);

  user = this.auth.currentUser;

  openInviteDialog() {
    this.dialog.open(InviteDialogComponent, {
      width: '400px',
      maxWidth: '90vw'
    });
  }

  logout() {
    this.auth.logout().subscribe(() => {
      this.router.navigateByUrl('/');
    });
  }
}
