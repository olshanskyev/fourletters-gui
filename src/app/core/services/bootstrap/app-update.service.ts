import { Injectable, inject, isDevMode } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { filter } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class AppUpdateService {
  private readonly updates = inject(SwUpdate);
  private readonly snackBar = inject(MatSnackBar);
  private readonly translate = inject(TranslateService);

  /**
   * Listen for service worker version updates for the whole app lifetime and
   * prompt the user to reload once a new version has been downloaded.
   */
  load(): void {
    if (isDevMode() || !this.updates.isEnabled) {
      return;
    }

    this.updates.versionUpdates
      .pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
      .subscribe(() => this.promptReload());
  }

  private promptReload(): void {
    const message = this.translate.instant('update_available');
    const action = this.translate.instant('reload');

    this.snackBar
      .open(message, action, { panelClass: 'snackbar-safe-area' })
      .onAction()
      .subscribe(async () => {
        await this.updates.activateUpdate();
        document.location.reload();
      });
  }
}
