import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { KeysUploadRequest } from '../../dto/keysUploadRequest';
import { KeysResponse } from '../../dto/keysResponse';
import { PublicKeysBatchResponse } from '../../dto/publicKeysBatchResponse';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class KeysApiService {
  private readonly http = inject(HttpClient);

  uploadKeys(request: KeysUploadRequest): Observable<void> {
    return this.http.put<void>('/keys', request);
  }

  getUserKeys(userId: string): Observable<KeysResponse> {
    return this.http.get<KeysResponse>(`/keys/${userId}`);
  }

  getBatchKeys(userIds: string[]): Observable<PublicKeysBatchResponse> {
    const idsParams = userIds.join(',');
    return this.http.get<PublicKeysBatchResponse>(`/keys?ids=${idsParams}`);
  }
}
