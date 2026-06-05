import { Routes } from '@angular/router';
import { MainLayoutComponent } from './layouts/main-layout/main-layout.component';
import { MainComponent } from './pages/main/main.component';

import { LoginComponent } from './pages/auth/login.component';
import { HomeComponent } from './pages/home/home.component';
import { loggedInGuard } from './core/guards';
import { DefaultLayoutComponent } from './layouts/default-layout/default-layout.component';

export const routes: Routes = [
  {
    path: '',
    component: DefaultLayoutComponent,
    children: [
      { path: '', component: HomeComponent },
    ],
  },
  {
    path: 'auth',
    component: DefaultLayoutComponent,
    children: [
      { path: 'login', component: LoginComponent },
      { path: '**', redirectTo: 'login' },
    ],
  },
  {
    path: 'm',
    component: MainLayoutComponent,
    canActivate: [loggedInGuard],
    canActivateChild: [loggedInGuard],
    children: [
      { path: '', component: MainComponent },
      { path: ':id', component: MainComponent }
    ]
  },
  { path: '**', redirectTo: 'm' },
];
