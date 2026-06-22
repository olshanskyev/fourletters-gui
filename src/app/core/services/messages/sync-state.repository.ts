import { Injectable, inject } from '@angular/core';
import { AppDatabase } from '@core/services/database/app.database';

/**
 * Single owner of the inbox sync watermark (`serverStartedAt`), used to detect server restarts
 * and decide which accepted-but-unconfirmed messages need resending.
 */
@Injectable({
  providedIn: 'root'
})
export class SyncStateRepository {

  private readonly db = inject(AppDatabase);

  /** The last server start timestamp this device observed, or undefined if never synced. */
  async getServerStartedAt(): Promise<number | undefined> {
    return this.db.getMeta<number>('serverStartedAt');
  }

  /** Record the server start timestamp from the latest inbox/batch response. */
  async setServerStartedAt(value: number): Promise<void> {
    await this.db.setMeta('serverStartedAt', value);
  }
}
