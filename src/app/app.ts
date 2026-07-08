import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NgProgressbar } from 'ngx-progressbar';
import { NgProgressHttp } from 'ngx-progressbar/http';
import { NgProgressRouter } from 'ngx-progressbar/router';

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
export class App {}
