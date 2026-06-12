import { Injectable, inject, DestroyRef } from '@angular/core';

import { catchError, of, Observable, distinctUntilChanged } from 'rxjs';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../authentication/auth.service';
import { NgxRolesService } from 'ngx-permissions';
import { HubService } from '../ws/hub.service';
import { UserResponse } from '../../dto/userResponse';


@Injectable({
  providedIn: 'root',
})
export class StartupService {
  private readonly authService = inject(AuthService);
  private readonly rolesService = inject(NgxRolesService);
  private readonly hubService = inject(HubService);
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
                takeUntilDestroyed(this.destroyRef)
              )
              .subscribe(user => {
                this.setPermissions(user);
                if (user) {
                  this.hubService.connect();
                } else {
                  this.hubService.disconnect();
                }
              });

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
