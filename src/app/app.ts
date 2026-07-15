import { Component, ChangeDetectionStrategy, inject, isDevMode } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NgProgressbar } from 'ngx-progressbar';
import { NgProgressHttp } from 'ngx-progressbar/http';
import { NgProgressRouter } from 'ngx-progressbar/router';
import { AuthService } from '@core/services/authentication';

declare global {
  interface Window {
    devAuth?: (token: string) => void;
  }
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NgProgressbar, NgProgressRouter, NgProgressHttp],
  template: `
    <ng-progress ngProgressHttp ngProgressRouter />
    <router-outlet />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: ``,
})
export class App {
  private readonly authService = inject(AuthService);

  constructor() {
    if (!isDevMode()) return;

    window.devAuth = (token: string) => {
      this.authService.auth(token, 'dummy');
    };
  }
}
