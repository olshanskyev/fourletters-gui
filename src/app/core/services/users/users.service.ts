import { Injectable, inject } from '@angular/core';
import { lastValueFrom, Observable } from 'rxjs';
import { UsersRepository } from './users.repository';
import { UsersApiService } from './users-api.service';
import { UserProfileRecord } from '@core/services/database/app.database';
import { staleWhileRevalidate } from '@core/services/cache/swr-cache';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable({
  providedIn: 'root'
})
export class UsersService {
  private repository = inject(UsersRepository);
  private api = inject(UsersApiService);

  /**
   * Retrieves a user profile, cache-first (SWR): returns the cached record immediately and only
   * hits the server when the cache is missing or stale.
   */
  getProfile(userId: string): Promise<UserProfileRecord | undefined> {
    return staleWhileRevalidate({
      readCache: () => this.repository.getProfile(userId),
      revalidate: () => this.fetchProfile(userId),
      ttlMs: CACHE_TTL_MS,
      onBackgroundError: err => console.error('Background profile refresh failed', err)
    });
  }

  getContactList(): Promise<UserProfileRecord[]> {
    return this.repository.getAllProfiles();
  }

  /**
   * Set (or clear) a local avatar override for a user. Stored locally only.
   */
  async setLocalAvatar(userId: string, localAvatarUrl: string | undefined): Promise<void> {
    const cached = await this.repository.getProfile(userId);
    const record: UserProfileRecord = {
      id: userId,
      username: cached?.username,
      avatarUrl: cached?.avatarUrl,
      localName: cached?.localName,
      localAvatarUrl,
      updatedAt: cached?.updatedAt ?? 0
    };
    await this.repository.putProfile(record);
  }

  /**
   * Fetch-and-observe a single profile: forces a server refresh, then streams the local record. The
   * cached value emits immediately and the refresh's cache write re-emits with the fresh data.
   */
  fetchAndObserveProfile(userId: string): Observable<UserProfileRecord | undefined> {
    this.fetchProfile(userId).catch(err =>
      console.error('Background profile refresh failed', err)
    );
    return this.repository.observeProfile(userId);
  }

  /**
   * Get-and-observe several profiles, cache-first: each id is read via {@link getProfile} (SWR), so
   * only missing or stale profiles hit the server, then streams the cached records live.
   */
  getAndObserveProfiles(userIds: string[]): Observable<UserProfileRecord[]> {
    userIds.forEach((id) => this.getProfile(id).catch(() => undefined));
    return this.repository.observeProfiles(userIds);
  }

  private async fetchProfile(userId: string): Promise<UserProfileRecord> {
    const dto = await lastValueFrom(this.api.getUser(userId));
    const cached = await this.repository.getProfile(userId);

    const record: UserProfileRecord = {
      id: dto.id,
      username: dto.username,
      avatarUrl: dto.avatarUrl,
      localName: cached?.localName,
      localAvatarUrl: cached?.localAvatarUrl,
      updatedAt: Date.now()
    };

    await this.repository.putProfile(record);
    return record;
  }
}
