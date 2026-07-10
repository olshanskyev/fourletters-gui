import { Injectable, inject } from '@angular/core';
import { CryptoService } from '@core/services/crypto';
import { SignalSessionService, PREKEY_LOW_WATERMARK, PREKEY_REPLENISH_BATCH } from '@core/services/crypto/signal';
import { KeysApiService } from './keys-api.service';
import { AppDatabase } from '@core/services/database/app.database';
import { IdentityRepository } from './identity.repository';
import { lastValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class IdentityService {
  private readonly cryptoService = inject(CryptoService);
  private readonly signal = inject(SignalSessionService);
  private readonly keysApi = inject(KeysApiService);
  private readonly appDb = inject(AppDatabase);
  private readonly identityRepo = inject(IdentityRepository);

  /**
   * Called during startup after authentication. Ensures the at-rest master key and the local Signal
   * identity exist; on a fresh device it generates the bundle and uploads it to the directory.
   */
  async ensureIdentityKeys(): Promise<void> {
    if (!this.appDb.isInitialized) {
      throw new Error('AppDatabase must be initialized before ensuring identity keys.');
    }

    let dbMasterKey = await this.identityRepo.getDbMasterKey();
    if (!dbMasterKey) {
      dbMasterKey = await this.cryptoService.generateDbMasterKey();
      await this.identityRepo.setDbMasterKey(dbMasterKey);
    }

    if (!(await this.signal.hasLocalIdentity())) {
      // Generate in memory, upload, and only persist locally on a 200
      const { upload, commit } = await this.signal.createIdentityBundle();
      await lastValueFrom(this.keysApi.uploadKeys(upload));
      await commit();
    }
  }

  /**
   * Reconcile this device's identity with the directory and top up its one-time pre-key pool. The
   * single count call also reports the directory's stored identity key: if it no longer matches this
   * device (a new-device login on a re-used account, or a lost entry), re-publish our identity so
   * peers can verify our receipts and open sessions with us. Otherwise replenish when the pool is
   * low. Safe to call on every startup.
   */
  async reconcileAndReplenishKeys(): Promise<void> {
    try {
      const { count, identityKey: directoryIdentityKey } =
        await lastValueFrom(this.keysApi.countPreKeys());
      const localIdentityKey = await this.signal.localIdentityKey();

      // Directory doesn't reflect this device: re-publish our identity (also refreshes the pool).
      if (localIdentityKey && directoryIdentityKey !== localIdentityKey) {
        const bundle = await this.signal.buildReuploadBundle();
        await lastValueFrom(this.keysApi.uploadKeys(bundle));
        return;
      }

      if (count >= PREKEY_LOW_WATERMARK) {
        return;
      }
      const oneTimePreKeys = await this.signal.generateMorePreKeys(PREKEY_REPLENISH_BATCH);
      await lastValueFrom(this.keysApi.replenishPreKeys({ oneTimePreKeys }));
    } catch (err) {
      console.error('Failed to reconcile/replenish one-time pre-keys:', err);
    }
  }

  /** Wipe local Signal state on revocation, forcing a fresh identity (and key-change warning) next login. */
  async revokeIdentity(): Promise<void> {
    await this.signal.wipe();
  }

  /** The local AES-GCM master key used for at-rest encryption. */
  async getDbMasterKey(): Promise<CryptoKey> {
    const key = await this.identityRepo.getDbMasterKey();
    if (!key) throw new Error('Missing AES-GCM Master Key.');
    return key;
  }
}