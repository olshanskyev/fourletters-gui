import { HttpHandlerFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';


import { BASE_URL_SERVER } from './base-url-interceptor';
import { AuthService } from '../services';
import { hasHttpScheme, includeBaseUrl } from './functions';


export function tokenInterceptor(req: HttpRequest<unknown>, next: HttpHandlerFn) {
  const authService = inject(AuthService);
  const tokenReader = authService.tokenReader;

  const baseUrlServer = inject(BASE_URL_SERVER, { optional: true });
  const shouldAppendToken = (url: string) =>
    !hasHttpScheme(url) || includeBaseUrl(url, baseUrlServer);

  if (tokenReader.isTokenValid() && shouldAppendToken(req.url)) {
    return next(
      req.clone({
        headers: req.headers.append('Authorization', tokenReader.getBearerToken()),
        withCredentials: true,
      })
    );
  }

  return next(req);
}
