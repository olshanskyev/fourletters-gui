import { Injectable, signal, Type } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SidePanelService {
  readonly component = signal<Type<unknown> | null>(null);
  readonly componentInputs = signal<Record<string, unknown>>({});
  readonly isOpen = signal<boolean>(false);

  /** True while a history entry we pushed for the open panel is still on top of the stack. */
  private historySeeded = false;

  constructor() {
    if (typeof window !== 'undefined') {
      // A browser/OS back gesture pops our seeded entry; close the panel instead of navigating.
      window.addEventListener('popstate', this.onPopState);
    }
  }

  open(componentToLoad: Type<unknown>, inputs: Record<string, unknown> = {}) {
    this.component.set(componentToLoad);
    this.componentInputs.set(inputs);
    this.isOpen.set(true);
    this.seedHistory();
  }

  close() {
    if (!this.isOpen()) {
      return;
    }
    // If our seeded entry is still on top, unwind it so the history stays consistent; the popstate
    // handler then flips the panel state closed. Otherwise just close directly.
    if (typeof window !== 'undefined' && this.historySeeded && window.history.state?.sidePanel) {
      window.history.back();
    } else {
      this.applyClose();
    }
  }

  toggle() {
    if (this.isOpen()) {
      this.close();
    } else if (this.component()) {
      this.isOpen.set(true);
      this.seedHistory();
    }
  }

  /**
   * Push the same-URL history entry so the back gesture pops the panel instead of leaving the current
   * route. Using the current URL keeps the router from performing a real navigation on popstate.
   */
  private seedHistory() {
    if (typeof window === 'undefined' || this.historySeeded) {
      return;
    }
    window.history.pushState({ ...window.history.state, sidePanel: true }, '', window.location.href);
    this.historySeeded = true;
  }

  private applyClose() {
    this.historySeeded = false;
    this.isOpen.set(false);
    this.componentInputs.set({});
  }

  private readonly onPopState = () => {
    if (this.isOpen()) {
      this.applyClose();
    }
  };
}

