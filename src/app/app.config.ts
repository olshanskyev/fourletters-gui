import {
  ApplicationConfig,
  importProvidersFrom,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { provideHotToastConfig } from '@ngxpert/hot-toast';
import { routes } from './app.routes';
import { BASE_URL_SERVER, StartupService, TranslateLangService, interceptors } from './core';
import { NgxPermissionsModule } from 'ngx-permissions';
import { environment } from '../environments/environment';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { progressInterceptor, provideNgProgressHttp } from 'ngx-progressbar/http';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    { provide: BASE_URL_SERVER, useValue: environment.baseUrlServer },
    provideRouter(routes, withComponentInputBinding()),
    provideHotToastConfig(),
    provideAppInitializer(() => inject(TranslateLangService).load()),
    provideAppInitializer(() => inject(StartupService).load()),
    provideHttpClient(withInterceptors([progressInterceptor, ...interceptors])),
    provideNgProgressHttp({}),
    provideTranslateService({
      loader: provideTranslateHttpLoader({ prefix: 'i18n/', suffix: '.json' }),
    }),
    importProvidersFrom(
      NgxPermissionsModule.forRoot(),
    )
  ],
};
