import {
  Directive, ElementRef, OnDestroy, computed, effect, inject, input,
} from '@angular/core';
import { LocalMessage } from '@core/services/messages/models/messages.model';
import { MessageSelectionService } from './message-selection.service';

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

/** Selects a message for reacting: long-press (touch), right-click or click (mouse). */
@Directive({
  selector: '[appMessageSelect]',
  host: {
    '[style.position]': 'selected() ? "relative" : null',
    '[style.z-index]': 'selected() ? 11 : null',
    '[style.transform]': 'selected() ? "scale(1.05)" : null',
    // Grows away from its own edge, so the bar aligned to that edge stays in place.
    '[style.transform-origin]': 'message().isMine ? "right center" : "left center"',
    '[style.transition]': '"transform 0.15s ease"',
    '(pointerdown)': 'onPointerDown($event)',
    '(pointermove)': 'onPointerMove($event)',
    '(pointerup)': 'cancelPress()',
    '(pointercancel)': 'cancelPress()',
    '(contextmenu)': 'onContextMenu($event)',
  },
})
export class MessageSelectDirective implements OnDestroy {
  readonly message = input.required<LocalMessage>({ alias: 'appMessageSelect' });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly selection = inject(MessageSelectionService);
  readonly selected = computed(
    () => this.selection.selectedMessage()?.message.id === this.message().id
  );

  private pressTimer?: ReturnType<typeof setTimeout>;
  private pressStart?: { x: number; y: number };
  private pointerType = '';
  private suppressClick = false;

  constructor() {
    // Capture phase, so a long-press or selecting click never also opens an image or a link.
    this.host.nativeElement.addEventListener('click', this.onClick, true);
    // Suppresses the iOS long-press callout that would cover the reaction bar.
    this.host.nativeElement.style.setProperty('-webkit-touch-callout', 'none');
    // Unlock once the message is deselected.
    effect(() => {
      if (!this.selected()) {
        this.lockTextSelection(false);
      }
    });
  }

  onPointerDown(event: PointerEvent): void {
    this.pointerType = event.pointerType;
    this.suppressClick = false;
    if (event.pointerType !== 'touch') {
      return;
    }
    this.pressStart = { x: event.clientX, y: event.clientY };
    // Must be set before OS starts its own long-press text selection, whose markers and menu
    // would draw over the reaction bar.
    this.lockTextSelection(true);
    clearTimeout(this.pressTimer);
    this.pressTimer = setTimeout(() => {
      this.suppressClick = true;
      window.getSelection()?.removeAllRanges();
      this.select();
    }, LONG_PRESS_MS);
  }

  onPointerMove(event: PointerEvent): void {
    if (this.pressStart && Math.hypot(
      event.clientX - this.pressStart.x, event.clientY - this.pressStart.y
    ) > MOVE_TOLERANCE_PX) {
      this.cancelPress();
    }
  }

  cancelPress(): void {
    clearTimeout(this.pressTimer);
    this.pressStart = undefined;
    if (!this.selected()) {
      this.lockTextSelection(false);
    }
  }

  private lockTextSelection(lock: boolean): void {
    const style = this.host.nativeElement.style;
    style.setProperty('-webkit-user-select', lock ? 'none' : '');
    style.setProperty('user-select', lock ? 'none' : '');
  }

  onContextMenu(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('a')) {
      return;
    }
    event.preventDefault();
    this.select();
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (this.suppressClick) {
      this.suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const target = event.target as HTMLElement;
    if (this.pointerType !== 'mouse' || target.closest('a, img')
      || window.getSelection()?.toString()) {
      return;
    }
    this.select();
  };

  private select(): void {
    if (this.message().kind !== 'system') {
      this.selection.select(this.message(), this.host.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.cancelPress();
    this.host.nativeElement.removeEventListener('click', this.onClick, true);
    if (this.selected()) {
      this.selection.clear();
    }
  }
}
