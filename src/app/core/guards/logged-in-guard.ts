import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../services';

export const loggedInGuard = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.tokenReader.isTokenValid() && auth.isLoggedIn()) {
    return true;
  }

  // Cold start from a push notification, or a tab the OS froze long enough for the short-lived
  // access token to expire: give the refresh-token session a chance to restore before bouncing to
  // the landing page. refresh() is deduped, so this reuses any restore already in flight from
  // StartupService instead of racing it.
  const restored = await firstValueFrom(auth.refresh());
  return restored && auth.isLoggedIn() ? true : router.parseUrl('/');
};
