import { Component, computed, input } from '@angular/core';

const SOIL = 52;

/** A potted plant that gets taller and leafier with your posting streak, and flowers at 14 days. */
@Component({
  selector: 'app-plant',
  template: `
    <svg viewBox="0 0 64 80" role="img" [attr.aria-label]="label()">
      @if (streak() > 0) {
        <path class="stem" [attr.d]="stem()" />
        @for (leaf of leaves(); track $index) {
          <path class="leaf" d="M0 0C3-6 10-8 16-5C11 0 5 2 0 0z" [attr.transform]="leaf" />
        }
        @if (flower(); as top) {
          <g [attr.transform]="'translate(32 ' + top + ')'">
            @for (a of petals; track a) {
              <ellipse
                class="petal"
                rx="3.2"
                ry="5.5"
                cy="-5"
                [attr.transform]="'rotate(' + a + ')'"
              />
            }
            <circle class="eye" r="3" />
          </g>
        }
      } @else {
        <ellipse class="seed" cx="32" cy="51" rx="3.5" ry="2.5" />
      }
      <rect class="rim" x="14" y="52" width="36" height="7" rx="2" />
      <path class="pot" d="M17 59h30l-4 19H21z" />
    </svg>
  `,
  styles: `
    :host {
      display: block;
      width: 72px;
      flex: none;
    }
    .stem {
      fill: none;
      stroke: var(--leaf);
      stroke-width: 2.5;
      stroke-linecap: round;
    }
    .leaf {
      fill: var(--leaf-bright);
    }
    .petal {
      fill: #f2b8c6;
    }
    .eye {
      fill: #f4c95d;
    }
    .seed {
      fill: var(--soil);
    }
    .rim {
      fill: var(--pot-dark);
    }
    .pot {
      fill: var(--pot);
    }
  `,
})
export class Plant {
  readonly streak = input(0);
  protected readonly petals = [0, 72, 144, 216, 288];

  private readonly height = computed(() => 10 + Math.min(this.streak(), 14) * 2.6);

  protected readonly stem = computed(() => {
    const h = this.height();
    return `M32 ${SOIL}C29 ${SOIL - h / 3} 35 ${SOIL - (2 * h) / 3} 32 ${SOIL - h}`;
  });

  protected readonly leaves = computed(() => {
    const count = Math.min(Math.ceil(this.streak() / 2), 7);
    const h = this.height();
    return Array.from({ length: count }, (_, i) => {
      const y = SOIL - (h * (i + 1)) / (count + 1.5);
      const side = i % 2 ? -1 : 1;
      return `translate(32 ${y.toFixed(1)}) scale(${side} 1) rotate(-28)`;
    });
  });

  protected readonly flower = computed(() =>
    this.streak() >= 14 ? SOIL - this.height() - 2 : null,
  );

  protected readonly label = computed(() => {
    const n = this.streak();
    if (!n) return 'A seed. No streak yet.';
    return `A plant grown from a ${n} day streak`;
  });
}
