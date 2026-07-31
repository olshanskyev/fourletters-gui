import { Injectable, signal, Type } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SidePanelService {
  readonly component = signal<Type<unknown> | null>(null);
  readonly componentInputs = signal<Record<string, unknown>>({});
  readonly isOpen = signal<boolean>(false);

  /**
   * True while the panel is being closed by a browser/OS back gesture, so the layout can skip the
   * slide animation (the native swipe already animates) while keeping it for button-driven closes.
   * Set by BackGestureService, which owns all history/back-gesture handling.
   */
  readonly suppressAnimation = signal<boolean>(false);

  open(componentToLoad: Type<unknown>, inputs: Record<string, unknown> = {}) {
    this.suppressAnimation.set(false);
    this.component.set(componentToLoad);
    this.componentInputs.set(inputs);
    this.isOpen.set(true);
  }

  close() {
    if (!this.isOpen()) {
      return;
    }
    this.isOpen.set(false);
    this.componentInputs.set({});
  }

  toggle() {
    if (this.isOpen()) {
      this.close();
    } else if (this.component()) {
      this.suppressAnimation.set(false);
      this.isOpen.set(true);
    }
  }
}

