import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { GameClient } from '../../game/game-client';
import { Card, sameCard } from '../../poker/cards';
import { PlayerState, Street } from '../../poker/engine';
import { PlayingCard } from '../playing-card/playing-card';
import { Seat } from '../seat/seat';

const STREET_LABELS: Record<Street, string> = {
  preflop: 'Pre-flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Showdown',
};

interface SeatSpot {
  player: PlayerState;
  index: number;
  /** Seat and bet-chip positions, % of the felt. */
  x: number;
  y: number;
  bx: number;
  by: number;
  /** Vertical positions on narrow screens, where side seats would cover the board. */
  my: number;
  mby: number;
  isMe: boolean;
}

@Component({
  selector: 'app-poker-table',
  imports: [PlayingCard, Seat],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './poker-table.html',
  styleUrl: './poker-table.css',
})
export class PokerTable {
  protected readonly client = inject(GameClient);
  protected readonly slots = [0, 1, 2, 3, 4];

  /**
   * Seats spaced evenly around the oval, rotated so you're always at the bottom. Going around
   * clockwise on screen matches the order of play.
   */
  protected readonly spots = computed<SeatSpot[]>(() => {
    const s = this.client.state();
    const t = s?.table;
    if (!s || !t) return [];
    const n = t.players.length;
    const mine = Math.max(
      0,
      t.players.findIndex((p) => p.id === s.you.id),
    );
    return t.players.map((player, index) => {
      const k = (index - mine + n) % n;
      const angle = ((90 + (k * 360) / n) * Math.PI) / 180;
      const x = 50 + 48 * Math.cos(angle);
      const y = 50 + 47 * Math.sin(angle);
      const isMe = k === 0;
      // On a phone the table is round and small: keep seats out of the middle band where the
      // community cards are, by pushing them at least 30% above or below center.
      const my = 50 + (y >= 50 ? 1 : -1) * Math.max(Math.abs(y - 50), 30);
      return {
        player,
        index,
        x,
        y,
        my: isMe ? y : my,
        mby: 50 + 0.55 * (my - 50),
        // Your own chips go beside your cards; everyone else's sit between them and the pot.
        bx: isMe ? 64 : 50 + 0.6 * (x - 50),
        by: isMe ? 80 : 50 + 0.55 * (y - 50),
        isMe,
      };
    });
  });

  protected readonly streetLabel = computed(() => {
    const t = this.client.table();
    if (!t || t.round === 0) return 'Shuffling…';
    if (t.handOver && !t.outcome?.showdown) return 'Round over';
    return STREET_LABELS[t.street];
  });

  /** Cards that made the winning hand(s), for highlighting at showdown. */
  protected readonly winningCards = computed<Card[]>(() => {
    const outcome = this.client.table()?.outcome;
    if (!outcome?.showdown) return [];
    return outcome.awards.flatMap((a) => outcome.hands[a.playerId]?.cards ?? []);
  });

  protected winAmount(playerId: string): number {
    const t = this.client.table();
    if (!t?.handOver) return 0;
    return t.outcome?.awards.find((a) => a.playerId === playerId)?.amount ?? 0;
  }

  protected handOf(playerId: string) {
    return this.client.table()?.outcome?.hands[playerId] ?? null;
  }

  protected isWinningCard(card: Card): boolean {
    return this.winningCards().some((c) => sameCard(c, card));
  }
}
