import { provideZonelessChangeDetection } from '@angular/core';
import { SettingsService } from './app/core';
import { TranslateService } from '@ngx-translate/core';

export default [
    provideZonelessChangeDetection()
];
