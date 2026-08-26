import {
  HttpErrorResponse, HttpHandlerFn, HttpRequest
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, take, throwError } from 'rxjs';

import { AuthService } from '../services';

const RETRY_HEADER = 'X-Refresh-Retry';

export function refreshRetryInterceptor(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
) {
  if (req.url.includes('/auth/') || req.headers.has(RETRY_HEADER)) {
    return next(req);
  }

  const authService = inject(AuthService);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) {
        return throwError(() => error);
      }
      if (error.status === 0) { // retry once on network error
        return next(req.clone({
          headers: req.headers.set(RETRY_HEADER, '1')
        }));
      }
      if (error.status === 403) { // retry once on 403 if the access token is expired
        return authService.refresh().pipe(
          take(1),
          switchMap((refreshed) =>
            refreshed
              ? next(req.clone({
                  headers: req.headers.set(RETRY_HEADER, '1')
                }))
              : throwError(() => error)
          )
        );
      }
      return throwError(() => error);
    })
  );
}
