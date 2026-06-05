import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { MatDividerModule } from '@angular/material/divider';
import { AuthService } from '../../core';

@Component({
  selector: 'app-user-button',
  template: `
    <button matIconButton [matMenuTriggerFor]="menu" class="user-button">
      <img [src]="user()?.avatarUrl" width="24" alt="avatar" />
    </button>

    <mat-menu #menu="matMenu">
      @if (user()?.username) {
        <button mat-menu-item disabled>
          <span>{{ user()?.username }}</span>
        </button>
        <mat-divider/>
      }
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
    MatMenuModule, TranslateModule, MatDividerModule],
})
export class UserButton {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  user = this.auth.currentUser;

  logout() {
    this.auth.logout().subscribe(() => {
      this.router.navigateByUrl('/');
    });
  }
}
