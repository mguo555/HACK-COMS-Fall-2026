import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AiService } from '../../ai/ai.service';
import { PERSONAS } from '../../ai/personas';
import { GAME_CONFIG } from '../../game/game.config';
import { GameService } from '../../game/game.service';

const STREET_NAMES: Partial<Record<string, string>> = {
  preflop: 'Pre-flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
};

/** Shown after each round: who won, and what each bot was thinking. */
@Component({
  selector: 'app-hand-result',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hand-result.html',
  styleUrl: './hand-result.css',
})
export class HandResult {
  protected readonly game = inject(GameService);
  private readonly ai = inject(AiService);

  protected readonly title = computed(() => {
    const t = this.game.table();
    if (!this.game.gameOver()) return `Round ${t?.round ?? ''} result`;
    return this.game.human()?.busted ? "You're out of chips" : 'You took every chip at the table';
  });

  protected readonly winners = computed(() => {
    const t = this.game.table();
    const outcome = t?.outcome;
    if (!t || !outcome) return [];
    return outcome.awards.map((a) => {
      const p = t.players.find((x) => x.id === a.playerId)!;
      return {
        name: p.isHuman ? 'You' : p.name,
        isHuman: p.isHuman,
        amount: a.amount,
        hand: outcome.hands[a.playerId]?.description ?? null,
      };
    });
  });

  /**
   * Per bot, in seat order: Gemini's reasoning in full, and moves made by the built-in logic
   * collapsed into one line (its "reasoning" is canned and not worth reading).
   */
  protected readonly thoughtsByBot = computed(() => {
    const thoughts = this.game.roundThoughts();
    return PERSONAS.map((persona) => {
      const mine = thoughts.filter((t) => t.botId === persona.id);
      return {
        persona,
        ai: mine
          .filter((t) => !t.offline)
          .map((t) => ({ ...t, label: `${STREET_NAMES[t.street] ?? t.street}: ${t.action}` })),
        builtIn: mine
          .filter((t) => t.offline)
          .map((t) => `${STREET_NAMES[t.street] ?? t.street}: ${t.action}`)
          .join(' · '),
      };
    }).filter((group) => group.ai.length > 0 || group.builtIn);
  });

  /** True when no bot used Gemini this round, so the panel can explain why. */
  protected readonly noAiThisRound = computed(
    () =>
      this.ai.status().state === 'online' &&
      GAME_CONFIG.aiDecisions === 'after-message' &&
      this.thoughtsByBot().every((g) => g.ai.length === 0),
  );

  protected next(): void {
    this.game.nextRound();
  }

  protected playAgain(): void {
    void this.game.startGame(this.game.humanName());
  }

  protected quit(): void {
    this.game.quitToMenu();
  }
}
