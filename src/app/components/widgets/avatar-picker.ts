import { Component, ChangeDetectionStrategy, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { fileToAvatarDataUrl } from '@core/utils/avatar-image';

@Component({
  selector: 'app-avatar-picker',
  template: `
    <div class="avatar-wrapper">
      @if (avatarUrl()) {
        <img [src]="avatarUrl()" class="avatar -large" alt="avatar" referrerpolicy="no-referrer" />
      } @else {
        <div class="avatar -large default-avatar"></div>
      }

      @if (editable()) {
        <button
          matMiniFab
          class="avatar-edit-button"
          aria-label="Change picture"
          [disabled]="isProcessing()"
          (click)="avatarInput.click()"
        >
          <mat-icon>photo_camera</mat-icon>
        </button>
        <input
          #avatarInput
          type="file"
          accept="image/*"
          class="d-none"
          (change)="onFileSelected($event)"
        />
      }
    </div>

    @if (error()) {
      <div class="avatar-error f-s-12 m-t-4">{{ error() }}</div>
    }
  `,
  styles: `
    .avatar-wrapper {
      position: relative;
      display: inline-flex;
    }

    .avatar-edit-button {
      position: absolute;
      right: 0;
      bottom: 0;
      transform: scale(0.85);
      transform-origin: bottom right;
    }

    .avatar-error {
      color: var(--mat-sys-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule],
})
export class AvatarPicker {
  /** The image to display. Falls back to a default placeholder when absent. */
  avatarUrl = input<string | undefined>(undefined);

  /** Whether the edit affordance (camera button + file input) is shown. */
  editable = input(true);

  /** Emits the processed avatar as a base64 data URL once a picture is selected. */
  avatarSelected = output<string>();

  isProcessing = signal(false);
  error = signal<string | undefined>(undefined);

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file
    if (!file) {
      return;
    }

    this.error.set(undefined);
    this.isProcessing.set(true);
    try {
      this.avatarSelected.emit(await fileToAvatarDataUrl(file));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to process the picture.');
    } finally {
      this.isProcessing.set(false);
    }
  }
}
