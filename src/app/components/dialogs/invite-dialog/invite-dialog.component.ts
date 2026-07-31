import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ClipboardModule } from '@angular/cdk/clipboard';
import { TranslateModule } from '@ngx-translate/core';
import { PublicUser } from '@dto/models';
import { AuthService } from '@core/services/authentication/auth.service';
import { UsersService } from '@core/services/users/users.service';
import { ConversationsService } from '@core/services/conversations/conversations.service';

/** Extracts the invited user id from an invite link (matches the path, ignoring the origin). */
function parseInviteTargetId(text: string): string | undefined {
  const match = text.match(/\/m\/invite\/([^/\s?#]+)/);
  return match?.[1];
}

@Component({
  selector: 'app-invite-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatProgressSpinnerModule,
    ClipboardModule,
    TranslateModule,
  ],
  template: `
    <h2 mat-dialog-title>Add friends</h2>
    <mat-dialog-content>
      <p>Share this link with your friends to invite them:</p>

      <mat-form-field appearance="outline" class="w-full m-t-8" subscriptSizing="dynamic">
        <mat-label>Invitation Link</mat-label>
        <input matInput [value]="inviteLink" readonly />
        <button mat-icon-button matSuffix [cdkCopyToClipboard]="inviteLink" matTooltip="Copy link">
          <mat-icon>content_copy</mat-icon>
        </button>
      </mat-form-field>

      <mat-divider class="m-y-16" />

      <p>Got an invite link? Paste it here to add the contact:</p>

      <mat-form-field appearance="outline" class="w-full m-y-8" subscriptSizing="dynamic">
        <mat-label>Invite link</mat-label>
        <input
          matInput
          [value]="pastedLink()"
          (input)="onLinkInput($event)"
          placeholder="https://.../m/invite/..."
        />
        <button mat-icon-button matSuffix matTooltip="Paste" (click)="pasteFromClipboard()">
          <mat-icon>content_paste</mat-icon>
        </button>
      </mat-form-field>

      @if (checking()) {
        <div class="d-flex align-items-center text-color-second">
          <mat-spinner diameter="18" />
          <span class="m-l-8">Checking…</span>
        </div>
      } @else if (isOwnLink()) {
        <p class="text-color-second">This is your own invite link.</p>
      } @else if (foundUser(); as user) {
        <div class="d-flex align-items-center p-b-8">
          @if (user.avatarUrl) {
            <img
              [src]="user.avatarUrl"
              class="avatar -small"
              alt="avatar"
              referrerpolicy="no-referrer"
            />
          } @else {
            <div class="avatar -small default-avatar"></div>
          }
          <span class="m-l-16 flex-grow-1">{{ user.username || user.id }}</span>
          <button mat-flat-button color="primary" [disabled]="adding()" (click)="add()">
            <mat-icon>person_add</mat-icon>
            <span>Add</span>
          </button>
        </div>
      } @else if (notFound()) {
        <p class="text-color-second">No registered user found for this link.</p>
      }
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
  private readonly usersService = inject(UsersService);
  private readonly conversationsService = inject(ConversationsService);
  private readonly router = inject(Router);
  private readonly dialogRef = inject(MatDialogRef<InviteDialogComponent>);

  // We can use the current origin plus an invite path as a placeholder link
  readonly inviteLink = `${window.location.origin}/m/invite/${this.authService.currentUser()?.id}`;

  readonly pastedLink = signal('');
  readonly checking = signal(false);
  readonly adding = signal(false);
  readonly foundUser = signal<PublicUser | undefined>(undefined);
  readonly notFound = signal(false);
  readonly isOwnLink = signal(false);

  onLinkInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.pastedLink.set(value);
    this.checkLink(value);
  }

  /**
   * Read the invite link from the clipboard on an explicit user tap.
   */
  async pasteFromClipboard(): Promise<void> {
    try {
      const text = await navigator.clipboard?.readText();
      if (text) {
        this.pastedLink.set(text);
        this.checkLink(text);
      }
    } catch {
      // Clipboard access denied/unavailable — the user can paste manually.
    }
  }

  private async checkLink(text: string): Promise<void> {
    this.foundUser.set(undefined);
    this.notFound.set(false);
    this.isOwnLink.set(false);

    const targetId = parseInviteTargetId(text);
    if (!targetId) {
      return;
    }
    if (targetId === this.authService.currentUser()?.id) {
      this.isOwnLink.set(true);
      return;
    }

    this.checking.set(true);
    try {
      const user = await this.usersService.lookupUser(targetId);
      // Ignore a stale result if the input changed while the request was in flight.
      if (parseInviteTargetId(this.pastedLink()) !== targetId) {
        return;
      }
      if (user) {
        this.foundUser.set(user);
      } else {
        this.notFound.set(true);
      }
    } catch (e) {
      console.error('Failed to look up invite link user:', e);
      this.notFound.set(true);
    } finally {
      this.checking.set(false);
    }
  }

  async add(): Promise<void> {
    const user = this.foundUser();
    if (!user || this.adding()) {
      return;
    }
    this.adding.set(true);
    try {
      await this.usersService.cacheProfile(user);
      const conversationId = await this.conversationsService.ensureDirectConversation(user.id);
      this.dialogRef.close();
      this.router.navigate(['/m', conversationId]);
    } catch (e) {
      console.error('Failed to add contact from invite link:', e);
      this.adding.set(false);
    }
  }
}
