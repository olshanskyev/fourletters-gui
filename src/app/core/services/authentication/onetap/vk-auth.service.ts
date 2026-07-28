import { ElementRef, inject, Injectable } from '@angular/core';

import * as VKID from '@vkid/sdk';

import { SettingsService } from '@core/services/shared';
import { environment } from '@env/environment';
import { OneTapProvider } from './onetap-provider';

/**
 * Result delivered on a successful VK login.
 *
 * The `idToken` is the security anchor: the backend verifies it via VK ID's /oauth2/public_info.
 * The display fields are fetched client-side and are sent to the backend for presentation only.
 */
export interface VKLoginResult {
    idToken: string;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
}

@Injectable({
    providedIn: 'root'
})
export class VKAuthService implements OneTapProvider<VKID.OneTapStyles, VKLoginResult> {

    private readonly settings = inject(SettingsService);
    private oneTap: VKID.OneTap | undefined = undefined;
    private initialized = false;
    private onLoginHandler?: (payload: VKLoginResult) => void;
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
                // The runtime response includes id_token (OIDC); the SDK type omits it.
                VKID.Auth.exchangeCode(code, deviceId)
                    .then((tokenResult) =>
                        this.deliverLoginResult(tokenResult as unknown as VKID.TokenResult))
                    .catch((error) => {
                        if (this.onErrorHandler) {
                            this.onErrorHandler(error);
                        }
                    });
            });
        return oneTap;
    }

    /**
     * Fetch the full profile (client-side, on the user's IP) and hand the id_token plus display
     * fields to the login handler. If the profile call fails we still log in with the id_token.
     */
    private deliverLoginResult(tokenResult: VKID.TokenResult) {
        VKID.Auth.userInfo(tokenResult.access_token)
            .then((info) => {
                const user = info.user;
                this.emitLoginResult({
                    idToken: tokenResult.id_token,
                    firstName: user?.first_name,
                    lastName: user?.last_name,
                    avatarUrl: user?.avatar
                });
            })
            .catch(() => this.emitLoginResult({ idToken: tokenResult.id_token }));
    }

    private emitLoginResult(result: VKLoginResult) {
        if (this.onLoginHandler) {
            this.onLoginHandler(result);
        }
    }

    public onLoginSuccess(handler: (result: VKLoginResult) => void) {
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