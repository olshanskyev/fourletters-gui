import { inject } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../services';

export const loggedInGuard = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.tokenReader.isTokenValid() && auth.isLoggedIn()) {
    return true;
  }

  // Cold start from a push notification, or a tab the OS froze long enough for the short-lived
  // access token to expire
  await auth.getFreshAccessToken();
  return auth.isLoggedIn() ? true : router.parseUrl('/');
};
