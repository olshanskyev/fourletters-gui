import { ElementRef, inject, Injectable } from '@angular/core';

import * as VKID from '@vkid/sdk';

import { SettingsService } from '../../shared/settings.service';
import { environment } from '../../../../../environments/environment';
import { OneTapProvider } from './onetap-provider';

export type VKTokenResult = Omit<VKID.TokenResult, 'id_token'>;

@Injectable({
    providedIn: 'root'
})
export class VKAuthService implements OneTapProvider<VKID.OneTapStyles, VKTokenResult> {

    private readonly settings = inject(SettingsService);
    private oneTap: VKID.OneTap | undefined = undefined;
    private initialized = false;
    private onLoginHandler?: (payload: VKTokenResult) => void;
    private onErrorHandler?: (error: any) => void;

    private readonly locale = this.settings.locale;

    private initConfig() {
        if (!this.initialized) {
            VKID.Config.init({
                app: environment.vkAppId,
                redirectUrl: environment.redirectUrl,
                responseMode: VKID.ConfigResponseMode.Callback,
                source: VKID.ConfigSource.LOWCODE
            });
            this.initialized = true;
        }
    }

    private createOneTap(): VKID.OneTap {
        const oneTap = new VKID.OneTap();
        oneTap
            .on(VKID.WidgetEvents.ERROR, (error: any) => {
                if (this.onErrorHandler) {
                    this.onErrorHandler(error);
                }
            })
            .on(VKID.OneTapInternalEvents.LOGIN_SUCCESS, (payload: any) => {
                const code = payload.code;
                const deviceId = payload.device_id;
                VKID.Auth.exchangeCode(code, deviceId)
                    .then((payload) => {
                        if (this.onLoginHandler)
                            this.onLoginHandler(payload);
                    })
                    .catch((error) => {
                        if (this.onErrorHandler) {
                            this.onErrorHandler(error);
                        }
                    });
            });
        return oneTap;
    }

    public onLoginSuccess(handler: (token: VKTokenResult) => void) {
        this.onLoginHandler = handler;
    }

    public onError(handler: (error: any) => void) {
        this.onErrorHandler = handler;
    }


    public renderOneTap(container: ElementRef<any>, styles?: Partial<VKID.OneTapStyles>) {
        this.initConfig();
        this.oneTap = this.createOneTap();
        container.nativeElement.innerHTML = '';
        this.oneTap.render({
            container: container.nativeElement,
            showAlternativeLogin: false,
            styles: {
                height: 40,
                borderRadius: 50,
                ...styles
            },
            lang: (this.locale() === 'ru-RU') ? VKID.Languages.RUS : VKID.Languages.ENG
        });
    }

}