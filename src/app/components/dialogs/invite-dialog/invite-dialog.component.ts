import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { ClipboardModule } from '@angular/cdk/clipboard';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '@core/services/authentication/auth.service';

@Component({
  selector: 'app-invite-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    ClipboardModule,
    TranslateModule,
  ],
  template: `
    <h2 mat-dialog-title>Invite friends</h2>
    <mat-dialog-content>
      <p>Share this link with your friends to invite them:</p>

      <mat-form-field appearance="outline" class="w-full mt-2">
        <mat-label>Invitation Link</mat-label>
        <input matInput [value]="inviteLink" readonly #linkInput />
        <button mat-icon-button matSuffix [cdkCopyToClipboard]="inviteLink" matTooltip="Copy link">
          <mat-icon>content_copy</mat-icon>
        </button>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: ``,
})
export class InviteDialogComponent {
  private readonly authService = inject(AuthService);
  // We can use the current origin plus an invite path as a placeholder link
  inviteLink = `${window.location.origin}/m/invite/${this.authService.currentUser()?.id}`;
}
