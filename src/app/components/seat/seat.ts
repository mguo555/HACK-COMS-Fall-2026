import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Card, sameCard } from '../../poker/cards';
import { PlayerState } from '../../poker/engine';
import type { PublicPersona } from '../../shared/personas';
import type { MoodLabel } from '../../shared/protocol';
import { PlayingCard } from '../playing-card/playing-card';

const HUMAN_COLOR = '#b18cff';
const MOOD_TEXT: Record<MoodLabel, string> = {
  steady: '',
  tilted: 'Tilted',
  shaken: 'Shaken',
  'on a heater': 'On a heater',
};

/** A player's spot at the table: cards, avatar, stack, mood, status and speech bubble. */
@Component({
  selector: 'app-seat',
  imports: [PlayingCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.turn]': 'isTurn()',
    '[class.out]': 'player().folded || player().busted',
    '[class.winner]': 'winAmount() > 0',
    '[class.me]': 'isMe()',
    '[class.revealed]': 'revealed()',
    '[style.--accent]': 'color()',
  },
  template: `
    @if (bubble()) {
      <div class="bubble" role="status">{{ bubble() }}</div>
    }
    <div class="cards">
      @for (card of player().hole; track $index) {
        <app-playing-card
          [card]="card"
          [faceDown]="card.rank === 0"
          [size]="isMe() ? 'lg' : 'sm'"
          [highlight]="isBest(card)"
          [dim]="player().folded"
        />
      }
    </div>
    <div class="plate">
      <div class="avatar">
        {{ initials() }}
        @if (dealer()) {
          <span class="dealer" title="Dealer">D</span>
        }
      </div>
      <div class="meta">
        <div class="name">{{ isMe() ? player().name + ' (you)' : player().name }}</div>
        <div class="stack">
          {{ player().stack }}
          @if (moodText()) {
            <span class="mood" [attr.data-mood]="mood()">{{ moodText() }}</span>
          }
        </div>
      </div>
    </div>
    <div class="status">
      @if (thinking()) {
        <span class="tag think"
          ><span class="typing"><i></i><i></i><i></i></span
        ></span>
      } @else if (player().busted) {
        <span class="tag">Out</span>
      } @else if (winAmount() > 0) {
        <span class="tag win">+{{ winAmount() }}</span>
      } @else if (player().lastAction) {
        <span class="tag" [class.fold]="player().folded">{{ player().lastAction }}</span>
      }
    </div>
    @if (handLabel()) {
      <div class="hand">{{ handLabel() }}</div>
    }
  `,
  styleUrl: './seat.css',
})
export class Seat {
  readonly player = input.required<PlayerState>();
  readonly isMe = input(false);
  readonly persona = input<PublicPersona | undefined>(undefined);
  readonly mood = input<MoodLabel | null>(null);
  readonly dealer = input(false);
  readonly isTurn = input(false);
  readonly thinking = input(false);
  readonly bubble = input<string | null>(null);
  readonly winAmount = input(0);
  readonly handLabel = input<string | null>(null);
  /** The five cards that made the winning hand, to highlight. */
  readonly bestCards = input<Card[]>([]);

  protected readonly color = computed(() => this.persona()?.color ?? HUMAN_COLOR);
  protected readonly initials = computed(
    () => this.persona()?.initials ?? this.player().name.slice(0, 2).toUpperCase(),
  );
  protected readonly revealed = computed(() => this.player().hole.some((c) => c.rank > 0));
  protected readonly moodText = computed(() => {
    const m = this.mood();
    return m ? MOOD_TEXT[m] : '';
  });

  protected isBest(card: Card): boolean {
    return this.bestCards().some((c) => sameCard(c, card));
  }
}
