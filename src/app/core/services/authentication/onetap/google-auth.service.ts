import { ElementRef, inject, Injectable, signal } from '@angular/core';

import { SettingsService } from '../../shared/settings.service';
import { environment } from '../../../../../environments/environment';

import * as GOOGLE from 'google-one-tap';
import { OneTapProvider } from './onetap-provider';

export type GoogleTokenResult = GOOGLE.CredentialResponse;

@Injectable({
    providedIn: 'root'
})
export class GoogleAuthService
            implements OneTapProvider<GOOGLE.GsiButtonConfiguration, GoogleTokenResult> {

    private readonly settings = inject(SettingsService);
    private initialized = false;
    private onLoginHandler?: (payload: GoogleTokenResult) => void;
    private readonly locale = this.settings.locale;

    private executeRender(container: ElementRef<any>,
        styles?: Partial<GOOGLE.GsiButtonConfiguration>) {
        const googleInstance = (window as any).google as typeof GOOGLE;

        googleInstance.accounts.id.renderButton(
            container.nativeElement,
            {
                type: 'standard',
                theme: 'filled_blue',
                size: 'large',
                text: 'signin_with',
                shape: 'pill',
                locale: this.locale(),
                ...styles
            }
        );
    }


    public onLoginSuccess(handler: (token: GOOGLE.CredentialResponse) => void) {
        this.onLoginHandler = handler;
    }

    public renderOneTap(container: ElementRef<any>,
        styles?: Partial<GOOGLE.GsiButtonConfiguration>) {
        if (this.initialized) {
            this.executeRender(container, styles);
            return;
        }

        const options: GOOGLE.IdConfiguration = {
            client_id: environment.googleClientId,
            auto_select: false,
            cancel_on_tap_outside: true,
            context: 'signin'
        };

        const googleOneTapFn = (GOOGLE as any).default || GOOGLE;

        // We only use this call to trigger the network download of the script.
        googleOneTapFn(options, () => {});

        // Poll for the network script to finish downloading
        const interval = setInterval(() => {
            const win = window as any;
            if (win.google && win.google.accounts && win.google.accounts.id) {
                clearInterval(interval);

                const googleRuntime = win.google as typeof GOOGLE;

                // 3. THE ONLY REAL CALLBACK:
                // We initialize here safely, capturing tokens from BOTH the One Tap overlay AND the physical button.
                googleRuntime.accounts.id.initialize({
                    client_id: environment.googleClientId,
                    //use_fedcm_for_prompt: true,
                    callback: (response: GoogleTokenResult) => {
                        if (this.onLoginHandler) {
                            this.onLoginHandler(response);
                        }
                    }
                });

                this.initialized = true;
                this.executeRender(container, styles);
            }
        }, 50);
    }
}