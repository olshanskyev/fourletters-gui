import { Injectable, signal, Type } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SidePanelService {
  readonly component = signal<Type<unknown> | null>(null);
  readonly componentInputs = signal<Record<string, unknown>>({});
  readonly isOpen = signal<boolean>(false);

  open(componentToLoad: Type<unknown>, inputs: Record<string, unknown> = {}) {
    this.component.set(componentToLoad);
    this.componentInputs.set(inputs);
    this.isOpen.set(true);
  }

  close() {
    this.isOpen.set(false);
    this.componentInputs.set({});
  }

  toggle() {
    if (this.isOpen()) {
      this.close();
    } else if (this.component()) {
      this.isOpen.set(true);
    }
  }
}
