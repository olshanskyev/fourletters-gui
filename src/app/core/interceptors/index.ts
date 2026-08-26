export * from './base-url-interceptor';

import { baseUrlInterceptor } from './base-url-interceptor';
import { refreshRetryInterceptor } from './refresh-retry-interceptor';
import { tokenInterceptor } from './token-interceptor';

// Http interceptor providers in outside-in order
export const interceptors = [
  baseUrlInterceptor,
  tokenInterceptor,
  refreshRetryInterceptor
];
