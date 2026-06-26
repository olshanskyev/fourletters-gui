import { Injectable, inject } from '@angular/core';
import { lastValueFrom } from 'rxjs';
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
   * Retrieves a user profile. Uses Stale-While-Revalidate caching strategy.
   * Returns immediately if cached, but fetches in background if stale.
   */
  getProfile(userId: string, forceRefresh = false): Promise<UserProfileRecord | undefined> {
    return staleWhileRevalidate({
      readCache: () => this.repository.getProfile(userId),
      revalidate: () => this.fetchAndCacheProfile(userId),
      ttlMs: CACHE_TTL_MS,
      forceRefresh,
      onBackgroundError: err => console.error('Background profile refresh failed', err)
    });
  }

  private async fetchAndCacheProfile(userId: string): Promise<UserProfileRecord> {
    const dto = await lastValueFrom(this.api.getUser(userId));
    const cached = await this.repository.getProfile(userId);

    const record: UserProfileRecord = {
      id: dto.id,
      username: dto.username,
      avatarUrl: dto.avatarUrl,
      localName: cached?.localName, // preserve custom local name if one exists
      updatedAt: Date.now()
    };

    await this.repository.putProfile(record);
    return record;
  }
}
