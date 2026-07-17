import { Injectable, inject } from '@angular/core';
import { AppDatabase, UserProfileRecord } from '@core/services/database/app.database';
import { liveQuery } from 'dexie';
import { from, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class UsersRepository {
  private readonly db = inject(AppDatabase);

  async getProfile(userId: string): Promise<UserProfileRecord | undefined> {
    return this.db.profiles.get(userId);
  }

  /**
   * Observe a single cached profile as a live query. Re-emits whenever the record is written, so a
   * background SWR refresh that fills a cache miss surfaces here.
   */
  observeProfile(userId: string): Observable<UserProfileRecord | undefined> {
    return from(liveQuery(() => this.db.profiles.get(userId)));
  }

  /**
   * Observe the cached profiles for `userIds` as a live query. Re-emits whenever any of those
   * profile records is written, so a background SWR refresh that fills a cache miss surfaces here.
   */
  observeProfiles(userIds: string[]): Observable<UserProfileRecord[]> {
    return from(
      liveQuery(async () => {
        const profiles = await this.db.profiles.bulkGet(userIds);
        return profiles.filter((p): p is UserProfileRecord => !!p);
      })
    );
  }

  async getAllProfiles(): Promise<UserProfileRecord[]> {
    return this.db.profiles.toArray();
  }

  async putProfile(profile: UserProfileRecord): Promise<void> {
    await this.db.profiles.put(profile);
  }

  async putProfiles(profiles: UserProfileRecord[]): Promise<void> {
    await this.db.profiles.bulkPut(profiles);
  }
}
