import {
  ApplicationConfig,
  importProvidersFrom,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, RouteReuseStrategy } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { provideHotToastConfig } from '@ngxpert/hot-toast';
import { routes } from './app.routes';
import {
  AppUpdateService,
  BackGestureService,
  BASE_URL_SERVER,
  StartupService,
  TranslateLangService,
  interceptors,
} from './core';
import { SameComponentRouteReuseStrategy } from './core/utils/same-component-route-reuse.strategy';
import { TelemetryService } from './core/services/telemetry/telemetry.service';
import { NgxPermissionsModule } from 'ngx-permissions';
import { environment } from '../environments/environment';
import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { progressInterceptor, provideNgProgressHttp } from 'ngx-progressbar/http';
import { provideServiceWorker } from '@angular/service-worker';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    { provide: BASE_URL_SERVER, useFactory: () => environment.baseUrlServer },
    provideRouter(routes, withComponentInputBinding()),
    { provide: RouteReuseStrategy, useClass: SameComponentRouteReuseStrategy },
    provideHotToastConfig(),
    provideAppInitializer(() => inject(TelemetryService).start()),
    provideAppInitializer(() => inject(TranslateLangService).load()),
    provideAppInitializer(() => inject(StartupService).load()),
    provideAppInitializer(() => inject(AppUpdateService).load()),
    provideAppInitializer(() => inject(BackGestureService).load()),
    provideHttpClient(withXhr(), withInterceptors([progressInterceptor, ...interceptors])),
    provideNgProgressHttp({}),
    provideTranslateService({
      loader: provideTranslateHttpLoader({ prefix: 'i18n/', suffix: '.json' }),
    }),
    importProvidersFrom(NgxPermissionsModule.forRoot()),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
