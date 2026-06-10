import { inject } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../services';

export const loggedInGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return (auth.tokenReader.isTokenValid() && auth.isLoggedIn()) ? true : router.parseUrl('/');
};
