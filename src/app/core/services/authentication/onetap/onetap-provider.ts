import { ElementRef } from '@angular/core';

/**
 * Generic interface for a One-Tap / social auth provider.
 *
 * TOptions - provider-specific render/initialization options
 * TLoginPayload - payload delivered to the login success handler
 */
export interface OneTapProvider<TOptions = any, TLoginPayload = any> {
    /** Render provider UI into the given container. */
    renderOneTap(container: ElementRef<HTMLElement>, options?: Partial<TOptions>): void;

    /** Register a callback invoked when login succeeds. */
    onLoginSuccess(handler: (payload: TLoginPayload) => void): void;

    /** Optional: register an error callback. */
    onError?(handler: (error: unknown) => void): void;
}