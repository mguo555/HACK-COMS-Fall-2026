import { Component, computed, input } from '@angular/core';
import { formatDay } from '../shared/days';
import { Countdown } from './countdown';

/** The day's theme, written on a garden hang tag. */
@Component({
  selector: 'app-theme-tag',
  imports: [Countdown],
  template: `
    <div class="tag">
      <span class="hole" aria-hidden="true"></span>
      <p class="eyebrow">
        {{ isToday() ? 'Today’s theme' : 'Theme' }} · <span class="long">{{ dayLabel() }}</span
        ><span class="short">{{ shortLabel() }}</span>
      </p>
      <h1 class="theme">{{ theme() }}</h1>
      @if (isToday() && nextDayAt()) {
        <p class="next">New theme in <app-countdown [to]="nextDayAt()" /></p>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      padding: 28px 0 24px;
    }
    .tag {
      position: relative;
      max-width: 640px;
      padding: 22px 28px 24px 64px;
      background: var(--tag);
      color: var(--tag-ink);
      border-radius: 6px 18px 18px 6px;
      clip-path: polygon(26px 0, 100% 0, 100% 100%, 26px 100%, 0 calc(100% - 26px), 0 26px);
      box-shadow: var(--shadow);
      transform: rotate(-1deg);
    }
    .hole {
      position: absolute;
      left: 22px;
      top: 50%;
      width: 14px;
      height: 14px;
      margin-top: -7px;
      border-radius: 50%;
      background: var(--bg);
      box-shadow:
        0 0 0 4px color-mix(in srgb, var(--tag-ink) 20%, var(--tag)),
        inset 0 1px 3px rgb(0 0 0 / 40%);
    }
    .short {
      display: none;
    }
    .eyebrow {
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      opacity: 0.8;
    }
    .theme {
      margin: 4px 0 2px;
      font-size: clamp(34px, 8vw, 56px);
      font-style: italic;
      font-weight: 500;
      line-height: 1.05;
      overflow-wrap: anywhere;
    }
    .next {
      font-size: 15px;
      opacity: 0.85;
      font-variant-numeric: tabular-nums;
    }
    @media (max-width: 480px) {
      .tag {
        padding: 18px 20px 20px 52px;
      }
      .hole {
        left: 18px;
      }
      .long {
        display: none;
      }
      .short {
        display: inline;
      }
    }
  `,
})
export class ThemeTag {
  readonly date = input.required<string>();
  readonly theme = input.required<string>();
  readonly isToday = input(false);
  readonly nextDayAt = input(0);

  protected readonly dayLabel = computed(() => formatDay(this.date()));
  protected readonly shortLabel = computed(() => formatDay(this.date(), 'short'));
}
