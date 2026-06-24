import { Injectable, inject } from '@angular/core';
import { AppDatabase } from '@core/services/database/app.database';

/** Device-local persistence for the AES-GCM at-rest master key. */
@Injectable({
  providedIn: 'root'
})
export class IdentityRepository {

  private readonly db = inject(AppDatabase);

  // --- At-rest master key ---------------------------------------------------------------

  /** The local AES-GCM master key, or undefined if not yet generated. */
  async getDbMasterKey(): Promise<CryptoKey | undefined> {
    return this.db.getMeta<CryptoKey>('dbMasterKey');
  }

  /** Persist the local AES-GCM master key. */
  async setDbMasterKey(key: CryptoKey): Promise<void> {
    await this.db.setMeta('dbMasterKey', key);
  }
}
