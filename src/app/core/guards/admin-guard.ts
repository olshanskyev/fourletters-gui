import { inject } from '@angular/core';
import { Router } from '@angular/router';

import { NgxRolesService } from 'ngx-permissions';
import { loggedInGuard } from './logged-in-guard';

export const adminGuard = () => {
  const router = inject(Router);
  const rolesService = inject(NgxRolesService);

  const isLoggedIn = loggedInGuard();
  if (isLoggedIn !== true) {
    return isLoggedIn;
  }
  return rolesService.getRole('ADMIN') !== undefined ? true : router.parseUrl('/');
};
