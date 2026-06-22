import { Injectable, inject } from '@angular/core';
import { AppDatabase, IdentityRecord, IdentityRecords } from '@core/services/database/app.database';

/**
 * Encapsulates device-local persistence for our own key material: the long-lived identity /
 * encryption key pairs and the AES-GCM at-rest master key.
 */
@Injectable({
  providedIn: 'root'
})
export class IdentityRepository {

  private readonly db = inject(AppDatabase);

  // --- Identity key pairs ---------------------------------------------------------------

  /** A stored key-pair record, or undefined if this device has not generated it yet. */
  async getIdentityKey(id: IdentityRecords): Promise<IdentityRecord | undefined> {
    return this.db.identity.get(id);
  }

  /** Add or update a key-pair record. */
  async putIdentityKey(record: IdentityRecord): Promise<void> {
    await this.db.identity.put(record);
  }

  /** Drop a key-pair record (session revocation). */
  async deleteIdentityKey(id: IdentityRecords): Promise<void> {
    await this.db.identity.delete(id);
  }

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
