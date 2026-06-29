import { Injectable, inject, DestroyRef } from '@angular/core';

import { catchError, of, Observable, distinctUntilChanged, concatMap } from 'rxjs';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../authentication/auth.service';
import { NgxRolesService } from 'ngx-permissions';
import { UserResponse } from '@core/dto/userResponse';
import { MessagesService } from '@core/services/messages/messages.service';
import { GroupsService } from '@core/services/groups/groups.service';
import { IdentityService } from '@core/services/identity/identity.service';

@Injectable({
  providedIn: 'root',
})
export class StartupService {
  private readonly authService = inject(AuthService);
  private readonly rolesService = inject(NgxRolesService);
  private readonly messagesService = inject(MessagesService);
  private readonly groupsService = inject(GroupsService);
  private readonly identityService = inject(IdentityService);
  private readonly destroyRef = inject(DestroyRef);

  private currentUser$!: Observable<UserResponse | undefined>;

  private readonly allPermissions: Record<string, string[]> = {
    ADMIN: ['*'],
    USER: []
  };
  /**
   * Load the application only after get the essential informations
   * such as permissions and roles.
   */
  constructor() {
    this.currentUser$ = toObservable(this.authService.currentUser);
  }

  load() {
    return new Promise<void>((resolve) => {
      // Try refresh first, then initialize the listener for the user state
      this.authService.refresh().pipe(
          catchError(() => of(false))
        ).subscribe({
          next: () => {
            this.currentUser$
              .pipe(
                distinctUntilChanged((prev, curr) => prev?.id === curr?.id),
                takeUntilDestroyed(this.destroyRef),
                concatMap(async user => {
                  this.setPermissions(user);
                  if (user) {
                    try {
                      await this.requestPersistentStorage();
                      await this.identityService.ensureIdentityKeys();
                      this.messagesService.startListening();
                      await this.identityService.replenishPreKeysIfLow();
                    } catch (e) {
                      console.error('Failed to initialize local crypto identity keys. Pausing message stream', e);
                    }
                    // Roster sync is non-critical and independent of crypto/messaging
                    this.groupsService.syncGroups().catch(e => console.error('Failed to sync groups', e));
                  } else {
                    this.messagesService.stopListening();
                  }
                })
              )
              .subscribe();

            resolve();
          },
          error: () => resolve()
        });
    });
  }

  private setPermissions(user: UserResponse | undefined) {
    this.rolesService.flushRolesAndPermissions();

    if (!user) return;

    user.roles?.forEach(role => {
      if (role in this.allPermissions) {
        this.rolesService.addRoleWithPermissions(role, this.allPermissions[role]);
      }
    });

  }

  /**
   * Ask the browser to make IndexedDB storage persistent so the Signal ratchet state (identity,
   * sessions, pre-keys) is not silently evicted under storage pressure.
   */
  private async requestPersistentStorage(): Promise<void> {
    try {
      if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
        await navigator.storage.persist();
      }
    } catch (e) {
      console.warn('Persistent storage request failed', e);
    }
  }
}
