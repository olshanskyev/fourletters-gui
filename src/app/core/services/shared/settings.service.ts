import { Injectable, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { AppSettings, defaults } from '../../settings';
import { registerLocaleData } from '@angular/common';
import localeRu from '@angular/common/locales/ru';
import { LocalStorageService } from './storage.service';

registerLocaleData(localeRu, 'ru');

@Injectable({
  providedIn: 'root',
})
export class SettingsService {
  private readonly key = 'fourletters';
  private readonly translate = inject(TranslateService);
  private readonly store = inject(LocalStorageService);

  private storedOptions: AppSettings = this.store.get(this.key);
  private _options = signal<AppSettings>(Object.assign(defaults, this.storedOptions));

  private readonly languages = ['en-US', 'ru-RU'];
  private readonly _locale = signal<string>(this.translateLang);

  public options = this._options.asReadonly();
  public locale = this._locale.asReadonly();

  constructor() {
    this.translate.addLangs(this.languages);
  }

  reset() {
    this.store.remove(this.key);
  }

  setOptions(options?: Partial<AppSettings>) {
    this._options.set(Object.assign(defaults, this._options(), options));
    this.store.set(this.key, this._options());
  }

  get translateLang() {
    if (this._options().language === 'auto') {
      const browserLang = navigator.language;
      return this.languages.includes(browserLang) ? browserLang : 'en-US';
    }
    return this._options().language;
  }

  setLanguage(language?: string) {
    if (language) {
      this.setOptions({ language });
      this.translate.use(language);
      this._locale.set(language);
    }
  }

}
