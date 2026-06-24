import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  KeysUploadRequest,
  KeysResponse,
  PublicKeysBatchResponse,
  PreKeysUploadRequest,
  PreKeyCountResponse
} from '@dto/models';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class KeysApiService {
  private readonly http = inject(HttpClient);

  /** Upload (replace) the caller's full pre-key bundle on a fresh device. */
  uploadKeys(request: KeysUploadRequest): Observable<void> {
    return this.http.put<void>('/keys', request);
  }

  /** Fetch a peer's pre-key bundle (consumes one one-time pre-key server-side). */
  getUserKeys(userId: string): Observable<KeysResponse> {
    return this.http.get<KeysResponse>(`/keys/${userId}`);
  }

  getBatchKeys(userIds: string[]): Observable<PublicKeysBatchResponse> {
    const idsParams = userIds.join(',');
    return this.http.get<PublicKeysBatchResponse>(`/keys?ids=${idsParams}`);
  }

  /** Append more one-time pre-keys to the caller's directory pool. */
  replenishPreKeys(request: PreKeysUploadRequest): Observable<void> {
    return this.http.post<void>('/keys/prekeys', request);
  }

  /** How many one-time pre-keys the caller still has server-side. */
  countPreKeys(): Observable<PreKeyCountResponse> {
    return this.http.get<PreKeyCountResponse>('/keys/prekeys/count');
  }
}
