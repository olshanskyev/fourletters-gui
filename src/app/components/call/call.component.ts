import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource, takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HotToastService } from '@ngxpert/hot-toast';
import { interval, map, of } from 'rxjs';
import { CallService, CallEnded } from '@core/services/calls/call.service';
import { LocalMediaService } from '@core/services/calls/local-media.service';
import { CallOutcome } from '@core/services/calls/models/call.model';
import { ConversationsService } from '@core/services/conversations/conversations.service';
import { callErrorKey, formatCallDuration } from './call-utils';

/** Full-screen overlay for the ringing / active 1:1 call; renders nothing while idle. */
@Component({
  selector: 'app-call',
  templateUrl: './call.component.html',
  styleUrls: ['./call.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, TranslateModule],
})
export class CallComponent {
  /** Why the caller's call did not go through; the callee needs no explanation. */
  private static readonly CALLER_NOTICES: Partial<Record<CallOutcome, string>> = {
    busy: 'call_busy',
    declined: 'call_declined',
    missed: 'call_no_answer',
  };

  readonly calls = inject(CallService);
  readonly media = inject(LocalMediaService);
  private readonly conversations = inject(ConversationsService);
  private readonly toast = inject(HotToastService);
  private readonly translate = inject(TranslateService);

  readonly call = this.calls.activeCall;

  readonly peer = rxResource({
    params: () => this.call()?.conversationId,
    stream: ({ params: id }) => id ? this.conversations.observeConversationView(id) : of(undefined),
  });

  readonly localHasVideo = computed(() => !!this.media.localStream()?.getVideoTracks().length);

  private readonly now = toSignal(interval(1000).pipe(map(() => Date.now())), {
    initialValue: Date.now(),
  });

  readonly duration = computed(() => {
    const connectedAt = this.call()?.connectedAt;
    return connectedAt ? formatCallDuration((this.now() - connectedAt) / 1000) : '';
  });

  constructor() {
    this.calls.ended.pipe(takeUntilDestroyed()).subscribe(ended => this.explainEnd(ended));
  }

  accept(withVideo: boolean): void {
    void this.calls.acceptCall(withVideo);
  }

  decline(): void {
    void this.calls.declineCall();
  }

  hangup(): void {
    void this.calls.hangup();
  }

  switchCamera(): void {
    this.calls.switchCamera().catch(err => this.showError(err));
  }

  private showError(err: unknown): void {
    this.toast.error(this.translate.instant(callErrorKey(err)));
  }

  private explainEnd({ call, outcome, error }: CallEnded): void {
    if (error) {
      this.showError(error);
      return;
    }
    if (outcome === 'failed') {
      this.toast.error(this.translate.instant('call_failed'));
      return;
    }
    const key = call.direction === 'outgoing' ? CallComponent.CALLER_NOTICES[outcome] : undefined;
    if (key) {
      this.toast.show(this.translate.instant(key));
    }
  }
}
