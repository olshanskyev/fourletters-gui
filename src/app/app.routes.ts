import { Routes } from '@angular/router';
import { MainLayoutComponent } from '@layouts';
import { MainComponent } from '@pages';


import { loggedInGuard } from '@core/guards';
import { DefaultLayoutComponent } from '@layouts';
import { HomeComponent } from '@pages';
import { PrivacyPolicyComponent, TermsOfServiceComponent, AboutComponent } from '@pages';
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
    // Public legal pages - reachable without authentication (required by OAuth review).
    path: '',
    component: DefaultLayoutComponent,
    children: [
      { path: 'about', component: AboutComponent },
      { path: 'privacy', component: PrivacyPolicyComponent },
      { path: 'terms', component: TermsOfServiceComponent },
    ],
  },
  {
    path: 'm',
    component: MainLayoutComponent,
    canActivate: [loggedInGuard],
    canActivateChild: [loggedInGuard],
    children: [
      { path: '', component: MainComponent },
      { path: 'invite/:inviteTargetId', component: MainComponent },
      { path: 'notify/:notifyKind/:notifyId', component: MainComponent },
      { path: ':id', component: MainComponent }
    ]
  },
  { path: '**', redirectTo: 'm' },
];
