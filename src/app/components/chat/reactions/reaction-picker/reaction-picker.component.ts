import { Component, computed, inject } from '@angular/core';
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HotToastService } from '@ngxpert/hot-toast';
import { AuthService } from '@core/services/authentication/auth.service';
import { ReactionsService } from '@core/services/messages/reactions.service';
import { ReactionBarComponent } from '../reaction-bar/reaction-bar.component';
import { MessageSelectionService } from '../message-selection.service';

/** Reaction bar height: 36px buttons + 2 × 4px padding (see reaction-bar styles). */
const BAR_HEIGHT = 44;
const BAR_GAP = 12;

/** Dims the chat and shows the reaction bar next to the selected message. */
@Component({
  selector: 'app-reaction-picker',
  imports: [OverlayModule, TranslateModule, ReactionBarComponent],
  templateUrl: './reaction-picker.component.html',
  styleUrl: './reaction-picker.component.scss',
  host: { '(document:keydown.escape)': 'close()' },
})
export class ReactionPickerComponent {
  private readonly selection = inject(MessageSelectionService);
  private readonly reactions = inject(ReactionsService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(HotToastService);
  private readonly translate = inject(TranslateService);

  readonly selectedMessage = this.selection.selectedMessage;

  readonly current = computed(() => {
    const myId = this.auth.currentUser()?.id;
    return myId ? this.selectedMessage()?.message.reactions?.[myId]?.emoji || undefined : undefined;
  });

  // Above the bubble, or below it when there is no room; aligned to the bubble's side (centered
  // on narrow screens by the .reaction-bar-pane global style).
  // Both anchor the bar's top: CDK's bottom anchoring is offset in iOS standalone PWAs.
  readonly positions = computed<ConnectedPosition[]>(() => {
    const x = this.selectedMessage()?.message.isMine ? 'end' : 'start';
    return [
      {
        originX: x, originY: 'top', overlayX: x, overlayY: 'top',
        offsetY: -(BAR_HEIGHT + BAR_GAP),
      },
      { originX: x, originY: 'bottom', overlayX: x, overlayY: 'top', offsetY: BAR_GAP },
    ];
  });

  async pick(emoji: string): Promise<void> {
    const selected = this.selectedMessage();
    this.close();
    if (!selected) {
      return;
    }
    try {
      await this.reactions.react(selected.message, emoji);
    } catch {
      this.toast.error(this.translate.instant('reaction_send_failed'));
    }
  }

  close(): void {
    this.selection.clear();
  }
}
