import { Injectable, inject, DestroyRef, signal, computed } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';

import { environment } from '@env/environment';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { SettingsService } from '@core/services/shared/settings.service';
import { PushSubscription as PushSubscriptionDto } from '@dto/models';

interface PushNotificationData {
  senderId?: string;
  groupId?: string;
  conversationId?: string;
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
  private readonly conversations = inject(ConversationsService);
  private readonly settings = inject(SettingsService);
  private readonly destroyRef = inject(DestroyRef);

  /** Collapse bursts of local notifications from the same conversation (mirrors the server). */
  private static readonly LOCAL_DEBOUNCE_MS = 15_000;
  private readonly lastLocalNotificationAt = new Map<string, number>();

  /** Fallback notification icon and monochrome status-bar badge (mirror the server payload). */
  private static readonly DEFAULT_ICON = '/web-app-manifest-192x192.png';
  private static readonly BADGE_ICON = '/notification-badge.svg';

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
    // Notification taps are routed by ngsw itself via the deep-link URL in the push payload
    // (see showLocalNotification / the server payload). No in-page click handler is required.
  }

  /**
   * Keep the installed-app icon badge in sync with the total unread count. Started after login so
   * the local database (which backs the unread stream) is initialized. Idempotent.
   */
  private badgeSyncStarted = false;
  private startBadgeSync(): void {
    if (this.badgeSyncStarted || !('setAppBadge' in navigator)) return;
    this.badgeSyncStarted = true;
    this.conversations
      .observeTotalUnread()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(total => this.setBadge(total));
  }

  private setBadge(total: number): void {
    // iOS gates the Badging API behind the Notifications permission: setAppBadge rejects with
    // NotAllowedError unless permission is granted. Skip the call rather than swallow that error.
    if (this.currentPermission() !== 'granted') return;
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    const update = total > 0 ? nav.setAppBadge?.(total) : nav.clearAppBadge?.();
    update?.catch(() => {
      // Badge updates are best-effort; ignore failures (e.g. permission/visibility restrictions).
    });
  }

  /**
   * Called once per login. Silently re-registers when permission is already granted.
   */
  async initOnLogin(): Promise<void> {
    // The unread stream is backed by the local DB, which is only ready after authentication.
    this.startBadgeSync();
    if (!this.swPush.isEnabled || !environment.vapidPublicKey) return;

    this.permission.set(this.currentPermission());
    await this.resubscribeIfGranted();
  }

  /**
   * Request notification permission (via a user gesture) and register the push subscription.
   */
  async enable(): Promise<void> {
    if (!this.swPush.isEnabled || !environment.vapidPublicKey) return;

    // Request permission explicitly within the user gesture. Relying on PushManager.subscribe() to
    // raise the prompt is unreliable on desktop browsers; Notification.requestPermission() is the
    // spec-compliant trigger and returns the outcome so we can update the banner state.
    let permission = this.currentPermission();
    if (permission === 'default' && typeof Notification !== 'undefined') {
      permission = await Notification.requestPermission();
    }
    this.permission.set(permission);

    if (permission !== 'granted') return;
    await this.subscribe();
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

  /**
   * Show a notification locally via the service worker. Used when a message arrives over the live
   * Hub connection while the app is backgrounded: the server only sends web-push while we are
   * disconnected, so a connected-but-hidden client would otherwise stay silent.
   */
  async showLocalNotification(
    title: string,
    body: string,
    data: PushNotificationData,
    icon?: string
  ): Promise<void> {
    if (!this.swPush.isEnabled || this.currentPermission() !== 'granted') return;
    const tag = data.groupId ?? data.senderId;
    if (tag && !this.passesLocalDebounce(tag)) return;
    try {
      const kind = data.groupId ? 'group' : 'sender';
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, {
        body,
        data: {
          ...data,
          // Deep-link straight to the conversation: ngsw navigates the focused/opened window to
          // this URL and the /m/notify route resolves sender/group to the local conversation, so
          // no in-page click handler is needed (mirrors the server payload).
          onActionClick: {
            default: tag
              ? { operation: 'navigateLastFocusedOrOpen', url: `/m/notify/${kind}/${tag}` }
              : { operation: 'focusLastFocusedOrOpen' }
          }
        },
        tag,
        icon: icon || PushService.DEFAULT_ICON,
        badge: PushService.BADGE_ICON
      });
    } catch (e) {
      console.warn('Failed to show local notification', e);
    }
  }

  /** True at most once per debounce window for a given conversation tag. */
  private passesLocalDebounce(tag: string): boolean {
    const now = Date.now();
    const previous = this.lastLocalNotificationAt.get(tag);
    if (previous !== undefined && now - previous < PushService.LOCAL_DEBOUNCE_MS) {
      return false;
    }
    this.lastLocalNotificationAt.set(tag, now);
    return true;
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
}
