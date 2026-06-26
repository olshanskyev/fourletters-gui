import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { PublicUser, UserBatchResponse } from '@dto/models';

@Injectable({
  providedIn: 'root'
})
export class UsersApiService {
  private http = inject(HttpClient);

  /** Fetch a single user's public profile. */
  getUser(userId: string): Observable<PublicUser> {
    return this.http.get<PublicUser>(`/users/${userId}`);
  }

  /** Batch fetch public profiles for several users. */
  getUsersBatch(userIds: string[]): Observable<UserBatchResponse> {
    const params = new HttpParams().set('ids', userIds.join(','));
    return this.http.get<UserBatchResponse>('/users', { params });
  }
}
