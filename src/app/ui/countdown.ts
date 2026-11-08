import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';

/** Time left until `to` (ms since the epoch), like "4h 12m" or "38s". */
@Component({
  selector: 'app-countdown',
  template: `{{ text() }}`,
})
export class Countdown {
  readonly to = input.required<number>();
  private readonly now = signal(Date.now());

  protected readonly text = computed(() => {
    const left = Math.max(0, this.to() - this.now());
    const h = Math.floor(left / 3_600_000);
    const m = Math.floor(left / 60_000) % 60;
    const s = Math.floor(left / 1000) % 60;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${s}s`;
    return `${s}s`;
  });

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
