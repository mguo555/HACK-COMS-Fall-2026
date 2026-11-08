import { Component, input, output } from '@angular/core';

/** A leaf that fills in when you like a photo. */
@Component({
  selector: 'app-like-button',
  template: `
    <button
      type="button"
      class="like"
      [class.on]="liked()"
      [disabled]="disabled()"
      [attr.aria-pressed]="disabled() ? null : liked()"
      [attr.aria-label]="label()"
      (click)="toggle.emit()"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path class="blade" d="M4.5 19.5C4.5 10 10 4.5 19.5 4.5c0 9.5-5.5 15-15 15z" />
        <path class="rib" d="M4.5 19.5 14 10" />
      </svg>
      <span>{{ count() }}</span>
    </button>
  `,
  styles: `
    .like {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 36px;
      padding: 0 10px 0 8px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--muted);
      font-weight: 600;
      font-size: 15px;
      font-variant-numeric: tabular-nums;
      cursor: pointer;
    }
    .like:hover:not(:disabled) {
      background: var(--leaf-soft);
      color: var(--leaf);
    }
    .like:disabled {
      cursor: default;
    }
    svg {
      width: 20px;
      height: 20px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .on {
      color: var(--leaf);
    }
    .on .blade {
      fill: var(--leaf-bright);
      stroke: var(--leaf);
    }
    .on .rib {
      stroke: var(--surface);
    }
    .on svg {
      animation: grow 0.35s cubic-bezier(0.3, 1.6, 0.5, 1);
    }
    @keyframes grow {
      from {
        transform: scale(0.5) rotate(-25deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .on svg {
        animation: none;
      }
    }
  `,
})
export class LikeButton {
  readonly count = input.required<number>();
  readonly liked = input(false);
  readonly disabled = input(false);
  readonly toggle = output<void>();

  protected label(): string {
    const likes = `${this.count()} ${this.count() === 1 ? 'like' : 'likes'}`;
    if (this.disabled()) return likes;
    return `${this.liked() ? 'Unlike' : 'Like'}, ${likes}`;
  }
}
