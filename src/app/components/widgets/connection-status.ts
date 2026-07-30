import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { HubService } from '@core/services/messages/ws/hub.service';

/**
 * Bare connection indicator for the live Hub: a spinner while connecting and a cloud-off icon while
 * waiting to reconnect. Nothing is shown once connected, so a healthy connection adds no noise.
 */
@Component({
  selector: 'app-connection-status',
  template: `
    @if (connectionState() === 'connecting') {
      <mat-spinner [diameter]="20" [strokeWidth]="2" class="m-r-12"/>
    } @else if (connectionState() === 'disconnected') {
      <mat-icon class="offline-icon m-r-12">cloud_off</mat-icon>
    }
  `,
  styles: `
    :host {
        display: flex;
        align-items: center;
    }
    .offline-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatProgressSpinnerModule, MatIconModule],
})
export class ConnectionStatus {
  private readonly hub = inject(HubService);
  readonly connectionState = this.hub.connectionState;
}
