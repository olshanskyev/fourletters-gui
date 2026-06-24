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
      const bundle = await this.signal.createIdentityBundle();
      try {
        await lastValueFrom(this.keysApi.uploadKeys(bundle));
      } catch (err) {
        console.error('Failed to upload Signal pre-key bundle:', err);
        // Roll back so the next login regenerates and retries (avoids a half-registered device).
        await this.signal.wipe();
        throw err;
      }
    }
  }

  /**
   * Top up the directory's one-time pre-key pool when it runs low, so peers can always open a
   * session with us. Safe to call on every startup.
   */
  async replenishPreKeysIfLow(): Promise<void> {
    try {
      const { count } = await lastValueFrom(this.keysApi.countPreKeys());
      if (count >= PREKEY_LOW_WATERMARK) {
        return;
      }
      const oneTimePreKeys = await this.signal.generateMorePreKeys(PREKEY_REPLENISH_BATCH);
      await lastValueFrom(this.keysApi.replenishPreKeys({ oneTimePreKeys }));
    } catch (err) {
      console.error('Failed to replenish one-time pre-keys:', err);
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