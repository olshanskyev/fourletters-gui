import { TestBed } from '@angular/core/testing';
import { ApplicationRef } from '@angular/core';
import { StartupService } from './startup.service';
import { AuthService } from '../authentication/auth.service';
import { NgxRolesService } from 'ngx-permissions';
import { MessagesService } from '@core/services/messages';
import { GroupsService } from '@core/services/groups/groups.service';
import { IdentityService } from '@core/services/identity/identity.service';
import { PushService } from '@core/services/push/push.service';
import { of } from 'rxjs';

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { UserResponse } from '@core/dto/userResponse';

describe('StartupService', () => {
  let service: StartupService;
  let authServiceMock: any;
  let rolesServiceMock: any;
  let messagesServiceMock: any;
  let groupsServiceMock: any;
  let identityServiceMock: any;
  let pushServiceMock: any;

  beforeEach(() => {
    // Mock AuthService
    authServiceMock = {
      refresh: vi.fn().mockReturnValue(of(true)),
      currentUser: vi.fn().mockReturnValue({
        id: '123e4567-e89b-12d3-a456-426614174000',
        username: 'admin_user',
        roles: ['ADMIN']
      } as UserResponse),
      tokenReader: {
        getBearerToken: vi.fn().mockReturnValue('fake-token'),
        getAccessToken: vi.fn().mockReturnValue('fake-token'),
      }
    };

    // Mock NgxRolesService
    rolesServiceMock = {
      flushRolesAndPermissions: vi.fn(),
      addRoleWithPermissions: vi.fn()
    };

    // Mock MessagesService
    messagesServiceMock = {
      startListening: vi.fn(),
      stopListening: vi.fn()
    };

    // Mock collaborators pulled in by StartupService.load()
    groupsServiceMock = {
      syncGroups: vi.fn().mockResolvedValue(undefined)
    };
    identityServiceMock = {
      ensureIdentityKeys: vi.fn().mockResolvedValue(undefined),
      reconcileAndReplenishKeys: vi.fn().mockResolvedValue(undefined)
    };
    pushServiceMock = {
      initOnLogin: vi.fn().mockResolvedValue(undefined)
    };

    TestBed.configureTestingModule({
      providers: [
        StartupService,
        { provide: AuthService, useValue: authServiceMock },
        { provide: NgxRolesService, useValue: rolesServiceMock },
        { provide: MessagesService, useValue: messagesServiceMock },
        { provide: GroupsService, useValue: groupsServiceMock },
        { provide: IdentityService, useValue: identityServiceMock },
        { provide: PushService, useValue: pushServiceMock }
      ]
    });

    service = TestBed.inject(StartupService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should call refresh, flush roles, and add ADMIN permissions if user has ADMIN role', async () => {
    // Call load and wait for it to resolve
    const p = service.load();
    TestBed.inject(ApplicationRef).tick();
    await p;

    // Verify AuthService calls
    expect(authServiceMock.refresh).toHaveBeenCalled();

    // Verify NgxRolesService interactions
    expect(rolesServiceMock.flushRolesAndPermissions).toHaveBeenCalled();
    expect(rolesServiceMock.addRoleWithPermissions).toHaveBeenCalledWith('ADMIN', ['*']);
  });

  it('should flush roles and add USER generic permissions when user has only USER role', async () => {
    authServiceMock.currentUser.mockReturnValue({
      id: '123e4567-e89b-12d3-a456-426614174000',
      username: 'normal_user',
      roles: ['USER']
    } as UserResponse);

    const p = service.load();
    TestBed.inject(ApplicationRef).tick();
    await p;

    expect(rolesServiceMock.flushRolesAndPermissions).toHaveBeenCalled();
    expect(rolesServiceMock.addRoleWithPermissions).toHaveBeenCalledWith('USER', []);
    expect(rolesServiceMock.addRoleWithPermissions).not.toHaveBeenCalledWith('ADMIN', ['*']);
  });

  it('should flush roles and do nothing else if user is undefined', async () => {
    authServiceMock.currentUser.mockReturnValue(undefined);

    const p = service.load();
    TestBed.inject(ApplicationRef).tick();
    await p;

    expect(rolesServiceMock.flushRolesAndPermissions).toHaveBeenCalled();
    expect(rolesServiceMock.addRoleWithPermissions).not.toHaveBeenCalled();
  });

  it('should resolve even if refresh throws an error', async () => {
    authServiceMock.refresh.mockReturnValue(of(false));

    const p = service.load();
    TestBed.inject(ApplicationRef).tick();
    await expect(p).resolves.toBeUndefined();
    expect(rolesServiceMock.flushRolesAndPermissions).toHaveBeenCalled();
  });
});
