import { Injectable, OnDestroy, computed, signal } from '@angular/core';
import { Subject, Subscription, share, timer } from 'rxjs';

import { JwtToken } from './token';
import { TokenReader } from './token-reader';


@Injectable()
export class TokenService implements OnDestroy, TokenReader {
  private readonly _currentToken = signal<JwtToken | undefined>(undefined);
  private readonly isValid = computed(() => this._currentToken()?.valid() ?? false);
  private readonly bearerToken = computed(() => this._currentToken()?.getBearerToken() ?? '');

  private readonly refresh$ = new Subject<JwtToken | undefined>();

  private timer$?: Subscription;

  private save(token?: string) {
    if (!token) {
      this._currentToken.set(undefined);
    } else {
      this._currentToken.set(new JwtToken(token));
    }

    this.setRefreshTimer();
  }

  private setRefreshTimer() {
    this.clearRefresh();
    const current = this._currentToken();
    if (current?.needRefresh()) {
      this.timer$ = timer(current.getRefreshTime() * 1000).subscribe(() => {
        this.refresh$.next(current);
      });
    }
  }

  private clearRefresh() {
    if (this.timer$ && !this.timer$.closed) {
      this.timer$.unsubscribe();
    }
  }

  refresh() {
    return this.refresh$.pipe(share());
  }

  set(token?: string) {
    this.save(token);
  }

  clear() {
    this.save();
  }

  ngOnDestroy(): void {
    this.clearRefresh();
  }

  sessionId() {
    return this._currentToken()?.jti;
  }

  isTokenValid(): boolean { return this.isValid(); }
  getBearerToken(): string { return this.bearerToken(); }

}
