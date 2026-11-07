import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { personaById } from '../../ai/personas';
import { GameService } from '../../game/game.service';
import { Card, sameCard } from '../../poker/cards';
import { Street } from '../../poker/engine';
import { PlayingCard } from '../playing-card/playing-card';
import { Seat } from '../seat/seat';

/**
 * Seat and bet-chip positions (% of the felt), clockwise from the human at the bottom.
 * Index matches the engine's player order: you, Viktor, Rosie, Big Tony, Nate.
 * `my`/`mby` are the vertical positions on narrow screens, where the table is round and the
 * side seats sit below the board so they don't cover it.
 */
const POSITIONS = [
  { x: 50, y: 97, my: 97, bx: 64, by: 80, mbx: 74, mby: 77 },
  { x: 3, y: 50, my: 76, bx: 21, by: 54, mbx: 18, mby: 64 },
  { x: 27, y: 4, my: 4, bx: 31, by: 29, mbx: 31, mby: 24 },
  { x: 73, y: 4, my: 4, bx: 69, by: 29, mbx: 69, mby: 24 },
  { x: 97, y: 50, my: 76, bx: 79, by: 54, mbx: 82, mby: 64 },
];

const STREET_LABELS: Record<Street, string> = {
  preflop: 'Pre-flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Showdown',
};

@Component({
  selector: 'app-poker-table',
  imports: [PlayingCard, Seat],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './poker-table.html',
  styleUrl: './poker-table.css',
})
export class PokerTable {
  protected readonly game = inject(GameService);
  protected readonly positions = POSITIONS;
  protected readonly slots = [0, 1, 2, 3, 4];
  protected readonly personaById = personaById;

  protected readonly streetLabel = computed(() => {
    const t = this.game.table();
    if (!t || t.round === 0) return 'Shuffling…';
    if (t.handOver && !t.outcome?.showdown) return 'Round over';
    return STREET_LABELS[t.street];
  });

  /** Cards that made the winning hand(s), for highlighting at showdown. */
  protected readonly winningCards = computed<Card[]>(() => {
    const outcome = this.game.table()?.outcome;
    if (!outcome?.showdown) return [];
    return outcome.awards.flatMap((a) => outcome.hands[a.playerId]?.cards ?? []);
  });

  protected winAmount(playerId: string): number {
    return this.game.table()?.outcome?.awards.find((a) => a.playerId === playerId)?.amount ?? 0;
  }

  protected handOf(playerId: string) {
    return this.game.table()?.outcome?.hands[playerId] ?? null;
  }

  protected isWinningCard(card: Card): boolean {
    return this.winningCards().some((c) => sameCard(c, card));
  }
}
