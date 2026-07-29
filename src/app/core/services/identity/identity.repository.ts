import { Injectable, inject } from '@angular/core';
import { AppDatabase } from '@core/services/database/app.database';

/** Device-local persistence for the AES-GCM at-rest master key. */
@Injectable({
  providedIn: 'root'
})
export class IdentityRepository {

  private readonly db = inject(AppDatabase);

  // In-memory cache of the master key, scoped to the user it was read for. iOS Safari is
  // pathologically slow (~1s) at deserializing a CryptoKey back out of IndexedDB, and the key is
  // read on every send, so we keep the live CryptoKey object in memory. Re-keyed on user switch.
  private cachedKey?: CryptoKey;
  private cachedForUser?: string;

  // --- At-rest master key ---------------------------------------------------------------

  /** The local AES-GCM master key, or undefined if not yet generated. */
  async getDbMasterKey(): Promise<CryptoKey | undefined> {
    const userId = this.db.userId;
    if (this.cachedKey && this.cachedForUser === userId) {
      return this.cachedKey;
    }
    const key = await this.db.getMeta<CryptoKey>('dbMasterKey');
    if (key) {
      this.cachedKey = key;
      this.cachedForUser = userId;
    }
    return key;
  }

  /** Persist the local AES-GCM master key. */
  async setDbMasterKey(key: CryptoKey): Promise<void> {
    await this.db.setMeta('dbMasterKey', key);
    this.cachedKey = key;
    this.cachedForUser = this.db.userId;
  }
}
