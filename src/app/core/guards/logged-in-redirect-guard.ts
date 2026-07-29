import { inject } from '@angular/core';
import { Router } from '@angular/router';

import { loggedInGuard } from './logged-in-guard';

export const loggedInRedirectGuard = async () => {
  const router = inject(Router);

  const result = await loggedInGuard();
  return result === true ? router.parseUrl('/m') : true;
};
