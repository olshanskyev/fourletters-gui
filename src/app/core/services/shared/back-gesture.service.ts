import { Injectable, effect, inject } from '@angular/core';
import { NavigationEnd, NavigationSkipped, Router } from '@angular/router';
import { filter } from 'rxjs';

import { SidePanelService } from './side-panel.service';

const CONVERSATIONS_URL = '/m';

interface EntryState {
  sentinel?: boolean;
  sidePanel?: boolean;
}

/**
 * Single owner of browser/OS back-gesture handling, so no component performs its own history
 * surgery.
 *
 *  1. Floor. iOS standalone PWAs eject to Safari / show an empty page when a back swipe targets
 *     the bottom of the WebView history stack. On every start of the installed app (icon, push,
 *     reload) two conversations-list sentinels are placed under the launch entry. A swipe that
 *     reaches one stays on the conversations list and re-arms the floor.
 *  2. Side panel trap. While chat settings are open, a pushed entry makes the back gesture close
 *     the panel instead of navigating.
 */
@Injectable({ providedIn: 'root' })
export class BackGestureService {
  private readonly sidePanel = inject(SidePanelService);
  private readonly router = inject(Router);

  /** True while a synthetic entry is trapping the back gesture for the open side panel. */
  private panelTrapArmed = false;

  /** Set when the panel is closed by the back gesture (not a button), so we don't double-unwind. */
  private panelClosingFromGesture = false;

  load(): void {
    if (typeof window === 'undefined') {
      return;
    }

    // Browser tabs keep native history so the user can leave the site.
    if (window.matchMedia('(display-mode: standalone)').matches) {
      this.layFloor();
    }

    window.addEventListener('popstate', this.onPopState);

    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd || event instanceof NavigationSkipped),
      )
      .subscribe(() => this.onNavigationSettled());

    // Mirror the side panel's open-state into a trapped history entry.
    effect(() => {
      if (this.sidePanel.isOpen()) {
        this.armPanelTrap();
      } else {
        this.disarmPanelTrap();
      }
    });
  }

  /** Runs before the router's first navigation, so the launch URL is still in the address. */
  private layFloor(): void {
    const { pathname, search, hash } = window.location;
    const sentinel: EntryState = { sentinel: true };
    window.history.replaceState(sentinel, '', CONVERSATIONS_URL);
    window.history.pushState(sentinel, '', CONVERSATIONS_URL);
    window.history.pushState(null, '', pathname + search + hash);
  }

  private armPanelTrap(): void {
    if (this.panelTrapArmed) {
      return;
    }
    this.panelTrapArmed = true;
    const state: EntryState = { ...this.currentState(), sidePanel: true };
    window.history.pushState(state, '', window.location.href);
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
    if (this.currentState().sidePanel) {
      window.history.back();
    }
  }

  private readonly onPopState = (event: PopStateEvent): void => {
    if ((event.state as EntryState | null)?.sentinel) {
      // Reached the floor; it is re-armed once the router has rendered the list.
      return;
    }

    if (this.sidePanel.isOpen()) {
      // A back gesture popped our trapped entry: close the panel. The native swipe already
      // animates, so suppress the slide (a button close keeps it).
      this.panelClosingFromGesture = true;
      this.sidePanel.suppressAnimation.set(true);
      this.sidePanel.close();
    }
  };

  private onNavigationSettled(): void {
    // The router rewrites the popped entry's state, so re-arm the floor only after it is done.
    if (this.currentState().sentinel) {
      window.history.pushState(null, '', window.location.href);
    }
  }

  private currentState(): EntryState {
    return (window.history.state ?? {}) as EntryState;
  }
}
