import { Injectable, inject } from '@angular/core';
import { AppDatabase, UserProfileRecord } from '@core/services/database/app.database';

@Injectable({
  providedIn: 'root'
})
export class UsersRepository {
  private readonly db = inject(AppDatabase);

  async getProfile(userId: string): Promise<UserProfileRecord | undefined> {
    return this.db.profiles.get(userId);
  }

  async putProfile(profile: UserProfileRecord): Promise<void> {
    await this.db.profiles.put(profile);
  }

  async putProfiles(profiles: UserProfileRecord[]): Promise<void> {
    await this.db.profiles.bulkPut(profiles);
  }
}
