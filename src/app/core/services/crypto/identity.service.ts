import { Injectable, inject } from '@angular/core';
import { CryptoService } from './crypto.service';
import { KeysApiService } from './keys-api.service';
import { AppDatabase } from '../database/app.database';
import { KeysUploadRequest } from '@dto/models';
import { lastValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class IdentityService {
  private readonly cryptoService = inject(CryptoService);
  private readonly keysApi = inject(KeysApiService);
  private readonly appDb = inject(AppDatabase);

  /**
   * Called during startup after authentication.
   * Checks if identity keys exist in the local Dexie store.
   * If they do not exist, generates them and uploads public key segments.
   */
  async ensureIdentityKeys(): Promise<void> {
    if (!this.appDb.isInitialized) {
      throw new Error('AppDatabase must be initialized before ensuring identity keys.');
    }

    const hasIdentityKey = await this.appDb.identity.get('identityKeyPair');
    const hasEncryptionKey = await this.appDb.identity.get('encryptionKeyPair');
    const hasDbMasterKey = await this.appDb.meta.get('dbMasterKey');

    let identityKeyPair = hasIdentityKey?.value;
    let encryptionKeyPair = hasEncryptionKey?.value;
    let dbMasterKey = hasDbMasterKey?.value;

    let keysNeedUpload = false;

    // Generate Missing Keys Locally
    if (!dbMasterKey) {
      dbMasterKey = await this.cryptoService.generateDbMasterKey();
      await this.appDb.setMeta('dbMasterKey', dbMasterKey);
    }

    if (!identityKeyPair) {
      identityKeyPair = await this.cryptoService.generateIdentityKeyPair();
      await this.appDb.identity.put({ id: 'identityKeyPair', value: identityKeyPair });
      keysNeedUpload = true;
    }

    if (!encryptionKeyPair) {
      encryptionKeyPair = await this.cryptoService.generateEncryptionKeyPair();
      await this.appDb.identity.put({ id: 'encryptionKeyPair', value: encryptionKeyPair });
      keysNeedUpload = true;
    }

    // Upload public key segments to Directory if fresh device
    if (keysNeedUpload) {
      const signingPublicKey = await this.cryptoService
        .exportPublicKeyBase64(identityKeyPair.publicKey);
      const encryptionPublicKey = await this.cryptoService
        .exportPublicKeyBase64(encryptionKeyPair.publicKey);

      const request: KeysUploadRequest = {
        signingPublicKey,
        encryptionPublicKey
      };

      try {
        await lastValueFrom(this.keysApi.uploadKeys(request));
      } catch (err) {
        console.error('Failed to upload identity keys:', err);
        // ToDo: retry or notificatation try later
        throw err;
      }
    }
  }

  /**
   * called during session revocation to wipe local identity keys, forcing regeneration on next login.
   */
  async revokeIdentity(): Promise<void> {
    await this.appDb.identity.delete('identityKeyPair');
    await this.appDb.identity.delete('encryptionKeyPair');
  }
}