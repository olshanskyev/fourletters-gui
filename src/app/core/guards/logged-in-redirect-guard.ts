import { inject } from '@angular/core';
import { Router } from '@angular/router';

import { loggedInGuard } from './logged-in-guard';

export const loggedInRedirectGuard = () => {
  const router = inject(Router);

  const isLoggedIn = loggedInGuard();
  if (isLoggedIn === true)
    return router.parseUrl('/m');

  return true;
};
