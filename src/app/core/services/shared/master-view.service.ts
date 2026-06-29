import { Injectable, signal } from '@angular/core';

export type MasterPaneView = 'conversations' | 'contacts' | 'create-group';

@Injectable({
  providedIn: 'root'
})
export class MasterViewService {
  readonly currentView = signal<MasterPaneView>('conversations');

  setView(view: MasterPaneView) {
    this.currentView.set(view);

  }
}
