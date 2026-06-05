import { Component, computed, effect, inject, signal, viewChild, OnDestroy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NgComponentOutlet } from '@angular/common';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatSidenav, MatSidenavContent, MatSidenavModule } from '@angular/material/sidenav';
import { Subscription } from 'rxjs/internal/Subscription';
import { SidePanelService } from '../../core/services/shared/side-panel.service';

const MOBILE_MEDIAQUERY = 'screen and (max-width: 1279px)';
const MONITOR_MEDIAQUERY = 'screen and (min-width: 1280px)';

@Component({
  selector: 'app-main-layout',
  templateUrl: './main-layout.component.html',
  styleUrls: ['./main-layout.component.scss'],
  standalone: true,
  imports: [
    RouterOutlet,
    MatSidenavModule,
    NgComponentOutlet
  ]
})
export class MainLayoutComponent implements OnDestroy {
  readonly sidenav = viewChild.required<MatSidenav>('sidenav');
  readonly content = viewChild.required<MatSidenavContent>('content');

  private readonly breakpointObserver = inject(BreakpointObserver);
  protected readonly sidePanelService = inject(SidePanelService);

  readonly isMobileScreen = signal(false);
  readonly isOver = computed(() => this.isMobileScreen());

  private layoutChangesSub = Subscription.EMPTY;

  constructor() {
    this.layoutChangesSub = this.breakpointObserver
      .observe([MOBILE_MEDIAQUERY, MONITOR_MEDIAQUERY])
      .subscribe(state => {
        if (state.breakpoints[MOBILE_MEDIAQUERY]) {
          this.isMobileScreen.set(true);
        } else {
          this.isMobileScreen.set(false);
        }
      });

    // Sync side-panel service state to the sidenav component
    effect(() => {
      const open = this.sidePanelService.isOpen();
      const sidenav = this.sidenav();
      if (open && !sidenav.opened) {
        sidenav.open();
      } else if (!open && sidenav.opened) {
        sidenav.close();
      }
    });
  }

  onSidenavClosed() {
    this.sidePanelService.close();
  }

  ngOnDestroy() {
    this.layoutChangesSub.unsubscribe();
  }
}