import { Injectable, inject } from '@angular/core';
import { CryptoService } from '@core/services/crypto';
import { KeysApiService } from './keys-api.service';
import { AppDatabase } from '@core/services/database/app.database';
import { IdentityRepository } from './identity.repository';
import { KeysUploadRequest } from '@dto/models';
import { lastValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class IdentityService {
  private readonly cryptoService = inject(CryptoService);
  private readonly keysApi = inject(KeysApiService);
  private readonly appDb = inject(AppDatabase);
  private readonly identityRepo = inject(IdentityRepository);

  /**
   * Called during startup after authentication.
   * Checks if identity keys exist in the local Dexie store.
   * If they do not exist, generates them and uploads public key segments.
   */
  async ensureIdentityKeys(): Promise<void> {
    if (!this.appDb.isInitialized) {
      throw new Error('AppDatabase must be initialized before ensuring identity keys.');
    }

    const hasIdentityKey = await this.identityRepo.getIdentityKey('identityKeyPair');
    const hasEncryptionKey = await this.identityRepo.getIdentityKey('encryptionKeyPair');

    let identityKeyPair = hasIdentityKey?.value;
    let encryptionKeyPair = hasEncryptionKey?.value;
    let dbMasterKey = await this.identityRepo.getDbMasterKey();

    let keysNeedUpload = false;

    // Generate Missing Keys Locally
    if (!dbMasterKey) {
      dbMasterKey = await this.cryptoService.generateDbMasterKey();
      await this.identityRepo.setDbMasterKey(dbMasterKey);
    }

    if (!identityKeyPair) {
      identityKeyPair = await this.cryptoService.generateIdentityKeyPair();
      await this.identityRepo.putIdentityKey({ id: 'identityKeyPair', value: identityKeyPair });
      keysNeedUpload = true;
    }

    if (!encryptionKeyPair) {
      encryptionKeyPair = await this.cryptoService.generateEncryptionKeyPair();
      await this.identityRepo.putIdentityKey({ id: 'encryptionKeyPair', value: encryptionKeyPair });
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
    await this.identityRepo.deleteIdentityKey('identityKeyPair');
    await this.identityRepo.deleteIdentityKey('encryptionKeyPair');
  }

  // --- Local key-material accessors (single source for private/symmetric keys) ---

  /** Our ECDSA signing private key, for signing outgoing payloads and receipts. */
  async getSigningPrivateKey(): Promise<CryptoKey> {
    return (await this.requireIdentity('identityKeyPair')).privateKey;
  }

  /** Our ECDH encryption private key, for decrypting inbound 1:1 payloads and unwrapping group keys. */
  async getEncryptionPrivateKey(): Promise<CryptoKey> {
    return (await this.requireIdentity('encryptionKeyPair')).privateKey;
  }

  /** Our ECDH encryption public key, for sealing a group key to ourselves. */
  async getEncryptionPublicKey(): Promise<CryptoKey> {
    return (await this.requireIdentity('encryptionKeyPair')).publicKey;
  }

  /** The local AES-GCM master key used for at-rest encryption. */
  async getDbMasterKey(): Promise<CryptoKey> {
    const key = await this.identityRepo.getDbMasterKey();
    if (!key) throw new Error('Missing AES-GCM Master Key.');
    return key;
  }

  private async requireIdentity(id: 'identityKeyPair' | 'encryptionKeyPair'): Promise<CryptoKeyPair> {
    const record = await this.identityRepo.getIdentityKey(id);
    if (!record) throw new Error('Local identity keys missing.');
    return record.value;
  }
}