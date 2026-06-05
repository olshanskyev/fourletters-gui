import { HttpHandlerFn, HttpRequest } from '@angular/common/http';
import { InjectionToken, inject } from '@angular/core';
import { hasHttpScheme } from './functions';

export const BASE_URL_SERVER = new InjectionToken<string>('BASE_URL_SERVER');

export function baseUrlInterceptor(req: HttpRequest<unknown>, next: HttpHandlerFn) {
  if (req.url.includes('.json')) // loading local sources
    return next(req);
  const baseUrlServer = inject(BASE_URL_SERVER, { optional: true });
  const hasScheme = (url: string) => baseUrlServer && hasHttpScheme(url);

  const prependBaseUrl = (url: string) =>
    [baseUrlServer?.replace(/\/$/g, ''), url.replace(/^\.?\//, '')].filter(val => val).join('/');

  return hasScheme(req.url) === false
    ? next(req.clone({ url: prependBaseUrl(req.url) }))
    : next(req);
}