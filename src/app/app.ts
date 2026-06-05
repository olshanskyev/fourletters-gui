import { Component, signal } from '@angular/core';
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
  styles: ``
})
export class App {
}
