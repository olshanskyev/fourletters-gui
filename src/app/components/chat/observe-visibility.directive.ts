import { Directive, ElementRef, EventEmitter, Input, OnDestroy, Output, OnChanges, SimpleChanges } from '@angular/core';

@Directive({
  selector: '[appObserveVisibility]',
  standalone: true
})
export class ObserveVisibilityDirective implements OnChanges, OnDestroy {
  @Input() appObserveVisibility: boolean | string = false;
  @Output() visible = new EventEmitter<void>();

  private observer: IntersectionObserver | undefined;

  constructor(private element: ElementRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['appObserveVisibility']) {
      if (this.appObserveVisibility && this.appObserveVisibility !== 'false') {
        this.startObserving();
      } else {
        this.disconnect();
      }
    }
  }

  private startObserving() {
    if (this.observer) return; // already observing

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          this.visible.emit();
          // We only want to track visibility once typically, so we can disconnect
          this.disconnect();
        }
      });
    }, { threshold: 0.5 }); // Trigger when at least 50% of the element is visible

    this.observer.observe(this.element.nativeElement);
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  private disconnect() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = undefined;
    }
  }
}
