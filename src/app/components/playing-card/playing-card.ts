import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Card, cardLabel, rankLabel, suitSymbol } from '../../poker/cards';

/** One playing card, face up or face down. */
@Component({
  selector: 'app-playing-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-size]': 'size()',
    '[class.face-down]': 'faceDown() || !card()',
    '[attr.data-suit]': 'faceDown() ? null : card()?.suit',
    '[class.highlight]': 'highlight()',
    '[class.dim]': 'dim()',
    role: 'img',
    '[attr.aria-label]': 'label()',
  },
  template: `
    @if (card() && !faceDown()) {
      <span class="corner"
        >{{ rank() }}<span>{{ suit() }}</span></span
      >
      <span class="pip">{{ suit() }}</span>
    }
  `,
  styles: `
    :host {
      --w: 52px;
      position: relative;
      display: inline-block;
      width: var(--w);
      aspect-ratio: 5 / 7;
      border-radius: calc(var(--w) * 0.12);
      background: #fdfcf8;
      color: var(--card-black);
      box-shadow:
        0 2px 6px rgb(0 0 0 / 35%),
        inset 0 0 0 1px rgb(0 0 0 / 8%);
      font-weight: 700;
      user-select: none;
      transition:
        transform 0.2s,
        box-shadow 0.2s,
        opacity 0.2s;
      animation: deal 0.25s ease-out;
    }
    :host([data-size='sm']) {
      --w: 38px;
    }
    :host([data-size='lg']) {
      --w: 62px;
    }
    :host([data-suit='h']) {
      color: var(--suit-h);
    }
    :host([data-suit='d']) {
      color: var(--suit-d);
    }
    :host([data-suit='c']) {
      color: var(--suit-c);
    }
    :host([data-suit='s']) {
      color: var(--suit-s);
    }
    :host(.face-down) {
      background: repeating-linear-gradient(45deg, #9b2335 0 4px, #b52b40 4px 8px);
      box-shadow:
        0 2px 6px rgb(0 0 0 / 35%),
        inset 0 0 0 3px #fdfcf8;
    }
    :host(.highlight) {
      transform: translateY(-6px);
      box-shadow:
        0 0 0 2px var(--gold),
        0 6px 14px rgb(0 0 0 / 45%);
    }
    :host(.dim) {
      opacity: 0.4;
    }
    .corner {
      position: absolute;
      top: 6%;
      left: 9%;
      display: flex;
      flex-direction: column;
      align-items: center;
      font-size: calc(var(--w) * 0.3);
      line-height: 1;
    }
    .corner span {
      font-size: 0.8em;
    }
    .pip {
      position: absolute;
      right: 10%;
      bottom: 6%;
      font-size: calc(var(--w) * 0.48);
      line-height: 1;
    }
    @keyframes deal {
      from {
        transform: translateY(-8px) scale(0.92);
        opacity: 0;
      }
    }
  `,
})
export class PlayingCard {
  readonly card = input<Card | null>(null);
  readonly faceDown = input(false);
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly highlight = input(false);
  readonly dim = input(false);

  protected readonly rank = computed(() => {
    const c = this.card();
    return c ? rankLabel(c.rank) : '';
  });
  protected readonly suit = computed(() => {
    const c = this.card();
    return c ? suitSymbol(c.suit) : '';
  });
  protected readonly label = computed(() => {
    const c = this.card();
    return c && !this.faceDown() ? cardLabel(c) : 'Face-down card';
  });
}
