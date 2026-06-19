import { Injectable, inject, DestroyRef } from '@angular/core';

import { catchError, of, Observable, distinctUntilChanged, concatMap } from 'rxjs';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../authentication/auth.service';
import { NgxRolesService } from 'ngx-permissions';
import { UserResponse } from '../../dto/userResponse';
import { MessagesService } from '../messages/messages.service';
import { IdentityService } from '../crypto/identity.service';

@Injectable({
  providedIn: 'root',
})
export class StartupService {
  private readonly authService = inject(AuthService);
  private readonly rolesService = inject(NgxRolesService);
  private readonly messagesService = inject(MessagesService);
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
                      await this.identityService.ensureIdentityKeys();
                      this.messagesService.startListening();
                    } catch (e) {
                      console.error('Failed to initialize local crypto identity keys. Pausing message stream', e);
                    }
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
}
