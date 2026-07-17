import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  CreateGroupRequest,
  Group,
  GroupSummary,
  UpdateGroupRequest,
  UpdateMembersRequest
} from '@dto/models';

@Injectable({
  providedIn: 'root'
})
export class GroupsApiService {
  private readonly httpClient = inject(HttpClient);

  /** Create a group with the caller as owner. */
  createGroup(request: CreateGroupRequest): Observable<Group> {
    return this.httpClient.post<Group>('/groups', request);
  }

  /** List the groups the caller is a member of. */
  listGroups(): Observable<GroupSummary[]> {
    return this.httpClient.get<GroupSummary[]>('/groups');
  }

  /** Fetch a group's roster. */
  getGroup(groupId: string): Observable<Group> {
    return this.httpClient.get<Group>(`/groups/${groupId}`);
  }

  /** Owner-only: add/remove members. */
  updateMembers(groupId: string, request: UpdateMembersRequest): Observable<Group> {
    return this.httpClient.patch<Group>(`/groups/${groupId}/members`, request);
  }

  /** Owner-only: partially update group metadata (name and/or avatar). */
  updateGroup(groupId: string, request: UpdateGroupRequest): Observable<Group> {
    return this.httpClient.patch<Group>(`/groups/${groupId}`, request);
  }

  /** Remove the caller from the group. */
  leaveGroup(groupId: string): Observable<void> {
    return this.httpClient.delete<void>(`/groups/${groupId}/members/me`);
  }
}
