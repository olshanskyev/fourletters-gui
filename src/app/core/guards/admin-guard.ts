import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot } from '@angular/router';

import { NgxRolesService } from 'ngx-permissions';
import { AuthService } from '../services';
import { loggedInGuard } from './logged-in-guard';

export const adminGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const rolesService = inject(NgxRolesService);

  return (loggedInGuard() && rolesService.getRole('ADMIN')) ? true : router.parseUrl('/auth/login');
};
