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
    // TEMP diagnostics: full snapshot of SW state so a single prod rollout tells us everything.
    this.logEnvironment();

    if (isDevMode() || !this.updates.isEnabled) {
      console.warn('[SW] update service NOT active', {
        isDevMode: isDevMode(),
        swEnabled: this.updates.isEnabled,
      });
      return;
    }

    // Log EVERY version event (not just VERSION_READY) with the version hashes so we can see the
    // exact lifecycle: DETECTED -> READY, or NO_NEW_VERSION_DETECTED, or INSTALLATION_FAILED.
    this.updates.versionUpdates.subscribe((event) => {
      console.info('[SW] versionUpdates event:', event.type, event);
    });

    // A corrupt/hash-mismatched cache lands here; log it so we know if the SW got wedged.
    this.updates.unrecoverable.subscribe((event) => {
      console.error('[SW] UNRECOVERABLE state:', event.reason);
    });

    this.updates.versionUpdates
      .pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
      .subscribe((event) => {
        console.info('[SW] VERSION_READY -> showing reload prompt', {
          current: event.currentVersion?.hash,
          latest: event.latestVersion?.hash,
        });
        this.promptReload();
      });

    // Force one update check as soon as the service is up, instead of waiting for the next
    // navigation. This is a single check (not polling) so it adds no ongoing traffic.
    console.info('[SW] calling checkForUpdate()...');
    this.updates
      .checkForUpdate()
      .then((found) => console.info('[SW] checkForUpdate result:', found))
      .catch((err) => console.error('[SW] checkForUpdate failed:', err));
  }

  /** TEMP: dump the raw browser service-worker registration state to the console. */
  private logEnvironment(): void {
    const swSupported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
    console.info('[SW] environment', {
      isDevMode: isDevMode(),
      swEnabled: this.updates.isEnabled,
      serviceWorkerSupported: swSupported,
      standalone:
        typeof window !== 'undefined' &&
        (window.matchMedia?.('(display-mode: standalone)').matches ||
          (window.navigator as unknown as { standalone?: boolean }).standalone === true),
      controller: swSupported ? !!navigator.serviceWorker.controller : false,
    });

    if (!swSupported) {
      return;
    }

    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        registrations.forEach((reg, i) => {
          console.info(`[SW] registration[${i}]`, {
            scope: reg.scope,
            active: reg.active?.scriptURL,
            waiting: reg.waiting?.scriptURL,
            installing: reg.installing?.scriptURL,
          });
        });
        if (registrations.length === 0) {
          console.warn('[SW] no service worker registrations found yet');
        }
      })
      .catch((err) => console.error('[SW] getRegistrations failed:', err));
  }

  private promptReload(): void {
    const message = this.translate.instant('update_available');
    const action = this.translate.instant('reload');

    console.info('[SW] opening snackbar', { message, action });
    this.snackBar
      .open(message, action, { panelClass: 'snackbar-safe-area' })
      .onAction()
      .subscribe(async () => {
        console.info('[SW] reload action tapped -> activateUpdate()');
        await this.updates.activateUpdate();
        document.location.reload();
      });
  }
}
