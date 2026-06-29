import { Injectable, signal, Type } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SidePanelService {
  readonly component = signal<Type<any> | null>(null);
  readonly isOpen = signal<boolean>(false);

  open(componentToLoad: Type<any>) {
    this.component.set(componentToLoad);
    this.isOpen.set(true);
  }

  close() {
    this.isOpen.set(false);
  }

  toggle() {
    if (this.isOpen()) {
      this.close();
    } else if (this.component()) {
      this.isOpen.set(true);
    }
  }
}
