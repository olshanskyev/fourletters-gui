import { Injectable, effect, inject } from '@angular/core';

import { SidePanelService } from './side-panel.service';

/**
 * Single owner of browser/OS back-gesture handling for the chat area, so no component performs its
 * own history surgery. It does two things:
 *
 *  1. Reserves a bottom guard history entry at startup. iOS standalone PWAs eject to Safari when a
 *     back-swipe targets the very bottom of the WebView history stack. On a cold start the auth
 *     guard redirect (`/` -> `/m`) uses replaceState, which collapses the launch entry and would
 *     otherwise leave conversations (or a chat opened on top of it) at the bottom. Keeping a guard
 *     entry underneath ensures the back-swipe out of a chat returns to the list instead of exiting.
 *  2. While the side panel (chat settings) is open, a synthetic history entry traps the back
 *     gesture so it closes the panel instead of navigating.
 */
@Injectable({ providedIn: 'root' })
export class BackGestureService {
  private readonly sidePanel = inject(SidePanelService);

  /** True while a synthetic entry is trapping the back gesture for the open side panel. */
  private panelTrapArmed = false;

  /** Set when the panel is closed by the back gesture (not a button), so we don't double-unwind. */
  private panelClosingFromGesture = false;

  load(): void {
    if (typeof window === 'undefined') {
      return;
    }

    // Reserve a same-URL guard entry at startup (before the router's first navigation) so real
    // content always sits above the bottom of the history stack and the back-swipe stays in-app.
    if (window.history.length === 1) {
      window.history.pushState(
        { ...window.history.state, backGuard: true },
        '',
        window.location.href,
      );
    }

    window.addEventListener('popstate', this.onPopState);

    // Mirror the side panel's open-state into a trapped history entry.
    effect(() => {
      if (this.sidePanel.isOpen()) {
        this.armPanelTrap();
      } else {
        this.disarmPanelTrap();
      }
    });
  }

  private armPanelTrap(): void {
    if (this.panelTrapArmed) {
      return;
    }
    this.panelTrapArmed = true;
    window.history.pushState(
      { ...window.history.state, sidePanel: true },
      '',
      window.location.href,
    );
  }

  private disarmPanelTrap(): void {
    if (!this.panelTrapArmed) {
      return;
    }
    this.panelTrapArmed = false;

    if (this.panelClosingFromGesture) {
      // The back gesture already consumed our trapped entry; nothing to unwind.
      this.panelClosingFromGesture = false;
      return;
    }

    // Button/backdrop close: remove the entry we pushed so history stays consistent.
    if (window.history.state?.sidePanel) {
      window.history.back();
    }
  }

  private readonly onPopState = (): void => {
    if (this.sidePanel.isOpen()) {
      // A back gesture popped our trapped entry: close the panel. The native swipe already
      // animates, so suppress the slide (a button close keeps it).
      this.panelClosingFromGesture = true;
      this.sidePanel.suppressAnimation.set(true);
      this.sidePanel.close();
    }
    // Otherwise the browser navigated to the `/m` entry behind the chat, which the Router renders
    // as the conversations list. No extra handling needed.
  };
}
