import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  CreateGroupRequest,
  Group,
  GroupSummary,
  GroupKeySet,
  GroupKeyDistribution,
  UpdateMembersRequest
} from '@dto/models';

/**
 * REST client for the Server's group endpoints. The Server owns the roster and epoch but only
 * relays opaque wrapped-key blobs — it never sees a group key.
 */
@Injectable({
  providedIn: 'root'
})
export class GroupsApiService {
  private readonly httpClient = inject(HttpClient);

  /** Create a group with the caller as owner and an epoch-0 key set wrapped to every member. */
  createGroup(request: CreateGroupRequest): Observable<Group> {
    return this.httpClient.post<Group>('/groups', request);
  }

  /** List the groups the caller is a member of. */
  listGroups(): Observable<GroupSummary[]> {
    return this.httpClient.get<GroupSummary[]>('/groups');
  }

  /** Fetch a group's roster and current epoch. */
  getGroup(groupId: string): Observable<Group> {
    return this.httpClient.get<Group>(`/groups/${groupId}`);
  }

  /** Owner-only: add/remove members and rotate the key in the same call (epoch compare-and-swap). */
  updateMembers(groupId: string, request: UpdateMembersRequest): Observable<Group> {
    return this.httpClient.patch<Group>(`/groups/${groupId}/members`, request);
  }

  /** Remove the caller from the group. */
  leaveGroup(groupId: string): Observable<void> {
    return this.httpClient.delete<void>(`/groups/${groupId}/members/me`);
  }

  /** Any member: publish a new epoch's group key for the current roster (epoch compare-and-swap). */
  rotateGroupKey(groupId: string, request: GroupKeyDistribution): Observable<Group> {
    return this.httpClient.post<Group>(`/groups/${groupId}/keys`, request);
  }

  /** Fetch the caller's wrapped group key for an epoch (defaults to the current epoch). */
  getGroupKey(groupId: string, epoch?: number): Observable<GroupKeySet> {
    let params = new HttpParams();
    if (epoch !== undefined) {
      params = params.set('epoch', String(epoch));
    }
    return this.httpClient.get<GroupKeySet>(`/groups/${groupId}/keys`, { params });
  }
}
