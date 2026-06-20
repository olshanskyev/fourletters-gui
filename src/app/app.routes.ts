import { Routes } from '@angular/router';
import { MainLayoutComponent } from '@layouts';
import { MainComponent } from '@pages';


import { loggedInGuard } from '@core/guards';
import { DefaultLayoutComponent } from '@layouts';
import { HomeComponent } from '@pages';
import { loggedInRedirectGuard } from '@core/guards';

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
