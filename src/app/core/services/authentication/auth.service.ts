import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, shareReplay, take, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { TokenService } from './token.service';

import { Router } from '@angular/router';
import { HttpClient, HttpErrorResponse, HttpStatusCode } from '@angular/common/http';
import { VKAuthService, VKTokenResult } from './onetap/vk-auth.service';
import { GoogleAuthService, GoogleTokenResult } from './onetap/google-auth.service';

import { UserResponse } from '../../dto/userResponse';
import { AuthResponse } from '../../dto/authResponse';
import { AuthRequest } from '../../dto/authRequest';
import { TokenReader } from './token-reader';
import { SettingsService } from '../shared';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly httpClient = inject(HttpClient);

  // encapsulate token service to prevent direct access from outside
  private readonly tokenService = new TokenService();
  public get tokenReader(): TokenReader { return this.tokenService; }

  private readonly settings = inject(SettingsService);
  private readonly vkService = inject(VKAuthService);
  private readonly googleService = inject(GoogleAuthService);

  private readonly router = inject(Router);
  private refreshInFlight$: Observable<boolean> | null = null;
  private _user = signal<UserResponse | undefined>(undefined);
  public readonly currentUser = this._user.asReadonly();
  public readonly isLoggedIn = computed(() => !!this._user());

  constructor() {
    this.vkService.onLoginSuccess((token) => this.vkLoggedIn(token));
    this.googleService.onLoginSuccess((token) => this.googleLoggedIn(token));
    // Listen to token auto-refresh internally
    this.tokenService.refresh()
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.refresh().subscribe());
  }

  private handlePositiveAuthResponse(authResponse: AuthResponse) {
    this.tokenService.set(authResponse.access_token);
    this._user.set(authResponse.user);
    const id = this.tokenService.sessionId();
    if (id) this.settings.setSessionId(id);
  }

  private auth(token: string, provider: string) {
    const authRequest: AuthRequest = {
      token
    };
    const source = this.httpClient.post<AuthResponse>(`/auth/${provider}`,
      authRequest,
      { withCredentials: true }
    );

    source.pipe(
      catchError(() => of(undefined)),
      tap(authResponse => {
        if (authResponse) {
          this.handlePositiveAuthResponse(authResponse);
          this.router.navigateByUrl('/m');
        }
      }),
    ).subscribe();
  }

  private vkLoggedIn(token: VKTokenResult) {
    this.auth(token.access_token, 'vk');
  }

  private googleLoggedIn(token: GoogleTokenResult) {
    this.auth(token.credential, 'google');
  }


  refresh() {
    const sessionId = this.settings.sessionId;

    if (!sessionId) {
      this.refreshInFlight$ = null;
      return of(false);
    }

    if (this.refreshInFlight$) {
      return this.refreshInFlight$;
    }

    const source = this.httpClient.post<AuthResponse>('/auth/refresh',
      {},
      {
        headers: { 'X-Session-ID': sessionId },
        withCredentials: true
      }
    );

    this.refreshInFlight$ = source.pipe(
      take(1),
      catchError((error: unknown) => {
        // not clear session in case server is unavailable,
        // to prevent user from being logged out due to temporary network issues
        if (error instanceof HttpErrorResponse &&
            error.status === HttpStatusCode.Unauthorized) {
            this.settings.setSessionId(undefined);
        }
        this.tokenService.clear();
        this._user.set(undefined);
        return of(undefined);
      }),
      tap(authResponse => {
        if (authResponse) {
          this.handlePositiveAuthResponse(authResponse);
        }
      }),
      map(() => this.tokenService.isTokenValid()),
      tap({ complete: () => this.refreshInFlight$ = null }),
      shareReplay(1)
    );

    return this.refreshInFlight$;
  }

  logout() {
    const source = this.httpClient.post<any>('/auth/logout',
      {},
      {withCredentials: true}
    );

    return source.pipe(
      catchError(() => of(null)),
      tap(() => {
        this.tokenService.clear();
        this._user.set(undefined);
        this.settings.setSessionId(undefined);
      }),
      map(() => !this.tokenService.isTokenValid())
    );
  }

  fetchUser() {
    const source = this.httpClient.get<UserResponse>('/auth/user');

    return source.pipe(
      catchError(() => of(undefined)),
      tap(user => {
        if (user) {
          this._user.set(user);
        }
      })
    );
  }


}
