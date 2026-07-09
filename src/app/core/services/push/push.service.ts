import { Injectable, inject, DestroyRef, signal, computed } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';

import { environment } from '@env/environment';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { SettingsService } from '@core/services/shared/settings.service';
import { PushSubscription as PushSubscriptionDto } from '@dto/models';

interface PushNotificationData {
  senderId?: string;
  groupId?: string;
}

/**
 * Web Push (VAPID) integration. Registers the browser's push subscription with the server.
 *
 * The push payload never carries E2E content: it only conveys sender/group identity so the click
 * handler can open the right local conversation. Notifications are rendered by the ngsw worker.
 */
@Injectable({
  providedIn: 'root'
})
export class PushService {
  private readonly swPush = inject(SwPush);
  private readonly httpClient = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly conversations = inject(ConversationsService);
  private readonly settings = inject(SettingsService);
  private readonly destroyRef = inject(DestroyRef);

  /** Current OS notification permission, kept in a signal so the UI can react. */
  private readonly permission = signal<NotificationPermission>(this.currentPermission());
  private readonly bannerDismissed = signal<boolean>(!!this.settings.options().pushBannerDismissed);

  /**
   * Whether to show the in-app "Enable notifications" banner
   */
  readonly showEnableBanner = computed(
    () =>
      this.swPush.isEnabled &&
      !!environment.vapidPublicKey &&
      this.permission() === 'default' &&
      !this.bannerDismissed()
  );

  constructor() {
    if (this.swPush.isEnabled) {
      this.swPush.notificationClicks
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(event => this.onNotificationClick(event.notification.data));
    }
  }

  /**
   * Called once per login. Silently re-registers when permission is already granted.
   */
  async initOnLogin(): Promise<void> {
    if (!this.swPush.isEnabled || !environment.vapidPublicKey) return;

    this.permission.set(this.currentPermission());
    await this.resubscribeIfGranted();
  }

  /**
   * Request notification permission (via a user gesture) and register the push subscription.
   */
  async enable(): Promise<void> {
    if (!this.swPush.isEnabled || !environment.vapidPublicKey) return;
    if (this.currentPermission() === 'denied') {
      this.permission.set('denied');
      return;
    }

    await this.subscribe();
    this.permission.set(this.currentPermission());
  }

  /** Re-register the subscription without prompting; only meaningful when already granted. */
  async resubscribeIfGranted(): Promise<void> {
    if (!this.swPush.isEnabled || this.currentPermission() !== 'granted') return;
    await this.subscribe();
  }

  /** Hide the enable-notifications banner (persisted); re-enabling is then done via OS settings. */
  dismissBanner(): void {
    this.bannerDismissed.set(true);
    this.settings.setOptions({ pushBannerDismissed: true });
  }

  private currentPermission(): NotificationPermission {
    return typeof Notification !== 'undefined' ? Notification.permission : 'denied';
  }

  /** Request the browser subscription and forward it to the server. */
  private async subscribe(): Promise<void> {
    try {
      const subscription = await this.swPush.requestSubscription({
        serverPublicKey: environment.vapidPublicKey,
      });
      await this.sendSubscription(subscription);
    } catch (e) {
      // User dismissed/denied the permission prompt, or subscription failed.
      console.warn('Push subscription failed', e);
    }
  }

  /**
   * Remove the push subscription from the server and unsubscribe locally. Should be called while
   * the auth token is still valid (e.g. at the start of logout).
   */
  async disable(): Promise<void> {
    this.httpClient
      .delete('/push/subscribe')
      .pipe(catchError(() => of(null)))
      .subscribe();

    if (!this.swPush.isEnabled) return;
    try {
      await this.swPush.unsubscribe();
    } catch {
      // No active subscription to remove.
    }
  }

  private async sendSubscription(subscription: PushSubscription): Promise<void> {
    const json = subscription.toJSON();
    const keys = json.keys;
    if (!json.endpoint || !keys?.['p256dh'] || !keys?.['auth']) {
      return;
    }

    const dto: PushSubscriptionDto = {
      endpoint: json.endpoint,
      keys: {
        p256dh: keys['p256dh'],
        auth: keys['auth']
      },
      expirationTime: json.expirationTime ?? undefined
    };

    this.httpClient
      .post('/push/subscribe', dto)
      .pipe(catchError(() => of(null)))
      .subscribe();
  }

  private async onNotificationClick(data: PushNotificationData): Promise<void> {
    try {
      let conversationId: string | undefined;
      if (data.groupId) {
        conversationId = await this.conversations.ensureGroupConversation(data.groupId);
      } else if (data.senderId) {
        conversationId = await this.conversations.ensureDirectConversation(data.senderId);
      }

      if (conversationId) {
        await this.router.navigate(['/m', conversationId]);
      } else {
        await this.router.navigate(['/m']);
      }
    } catch (e) {
      console.warn('Failed to open conversation from notification', e);
      await this.router.navigate(['/m']);
    }
  }
}
