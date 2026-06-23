import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  CreateGroupRequest,
  Group,
  GroupSummary,
  UpdateMembersRequest
} from '@dto/models';

/**
 * REST client for the Server's group endpoints. The Server owns the roster; a group message is
 * sent by the client as one independent 1:1 copy per member, so no group key crosses the Server.
 */
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

  /** Remove the caller from the group. */
  leaveGroup(groupId: string): Observable<void> {
    return this.httpClient.delete<void>(`/groups/${groupId}/members/me`);
  }
}
