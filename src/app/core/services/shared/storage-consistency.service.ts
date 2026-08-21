import { Injectable, inject } from '@angular/core';
import { AppDatabase } from '@core/services/database/app.database';

/**
 * Detects local message-store data loss (the iOS relaxed-durability / eviction failure mode) and
 * emits telemetry only when it actually happens. Messages are never deleted by the app, so the
 * persisted count is monotonic within a user — a drop across a restart means the store lost rows.
 * The watermark lives in localStorage (synchronous, more crash‑resistant than IndexedDB) so it
 * survives the same event that loses the messages.
 */
@Injectable({
  providedIn: 'root'
})
export class StorageConsistencyService {
  private readonly appDb = inject(AppDatabase);
  private started = false;
  private userId?: string;

  /** Compare the current count to the last snapshot (emitting on a drop), then track this session. */
  async start(userId: string): Promise<void> {
    this.userId = userId;
    await this.checkOnce(userId);
    if (this.started || typeof window === 'undefined') {
      return;
    }
    this.started = true;
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void this.snapshot();
      }
    });
    window.addEventListener('pagehide', () => void this.snapshot());
  }

  private key(userId: string): string {
    return `fl:msgHwm:${userId}`;
  }

  private async checkOnce(userId: string): Promise<void> {
    try {
      await this.appDb.whenInitialized();
      const count = await this.appDb.messages.count();
      const stored = Number(localStorage.getItem(this.key(userId)));
      if (Number.isFinite(stored) && count < stored) {
        const persisted = await navigator.storage?.persisted?.().catch(() => undefined);
        const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
        console.error('Storage consistency: local message count dropped', {
          expected: stored,
          actual: count,
          persisted,
          quota: estimate?.quota,
          usage: estimate?.usage
        });
      }
      localStorage.setItem(this.key(userId), String(count));
    } catch {
      // Diagnostic only; never disrupt startup.
    }
  }

  /** Raise the watermark to include messages added this session, before the app is backgrounded. */
  private async snapshot(): Promise<void> {
    if (!this.userId || !this.appDb.isInitialized) {
      return;
    }
    try {
      const count = await this.appDb.messages.count();
      const stored = Number(localStorage.getItem(this.key(this.userId)));
      if (!Number.isFinite(stored) || count > stored) {
        localStorage.setItem(this.key(this.userId), String(count));
      }
    } catch {
      // Best-effort snapshot.
    }
  }
}
