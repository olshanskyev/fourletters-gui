import { Routes } from '@angular/router';
import { MainLayoutComponent } from './layouts/main-layout/main-layout.component';
import { MainComponent } from './pages/main/main.component';


import { loggedInGuard } from './core/guards';
import { DefaultLayoutComponent } from './layouts/default-layout/default-layout.component';
import { HomeComponent } from './pages/home/home.component';
import { loggedInRedirectGuard } from './core/guards/logged-in-redirect-guard';

export const routes: Routes = [
  {
    path: '',
    canActivate: [loggedInRedirectGuard],
    component: DefaultLayoutComponent,
    children: [
      { path: '', component: HomeComponent },
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
