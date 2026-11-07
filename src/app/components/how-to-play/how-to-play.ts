import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  model,
  viewChild,
} from '@angular/core';
import { parseCards } from '../../poker/cards';
import { PlayingCard } from '../playing-card/playing-card';

const RANKINGS = [
  { name: 'Royal flush', what: 'A, K, Q, J, 10, all the same suit', cards: 'As Ks Qs Js Ts' },
  { name: 'Straight flush', what: 'Five in a row, all the same suit', cards: '9h 8h 7h 6h 5h' },
  { name: 'Four of a kind', what: 'Four cards of the same rank', cards: 'Kd Kh Kc Ks 3d' },
  { name: 'Full house', what: 'Three of a kind plus a pair', cards: 'Qd Qh Qc 7s 7d' },
  { name: 'Flush', what: 'Any five of the same suit', cards: 'Ah 9h 7h 4h 2h' },
  { name: 'Straight', what: 'Five in a row, any suits', cards: 'Ts 9d 8c 7h 6s' },
  { name: 'Three of a kind', what: 'Three cards of the same rank', cards: '8s 8d 8c Kh 2s' },
  { name: 'Two pair', what: 'Two different pairs', cards: 'Js Jd 4c 4h As' },
  { name: 'Pair', what: 'Two cards of the same rank', cards: 'Ts Td 4c 8h As' },
  {
    name: 'High card',
    what: 'None of the above: your highest card plays',
    cards: 'As Jd 9c 7h 4s',
  },
].map((r) => ({ ...r, cards: parseCards(r.cards) }));

/** A plain-language guide to poker and to this game, for people who have never played. */
@Component({
  selector: 'app-how-to-play',
  imports: [PlayingCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './how-to-play.html',
  styleUrl: './how-to-play.css',
})
export class HowToPlay {
  readonly open = model(false);
  protected readonly rankings = RANKINGS;
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    // A native <dialog> gives focus trapping, Escape to close and screen reader support for free.
    effect(() => {
      const el = this.dialog()?.nativeElement;
      if (!el) return;
      if (this.open() && !el.open) el.showModal();
      if (!this.open() && el.open) el.close();
    });
  }

  protected close(): void {
    this.open.set(false);
  }
}
