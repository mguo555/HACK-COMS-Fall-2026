import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { GAME_CONFIG } from '../../game/game.config';
import { GameClient } from '../../game/game-client';
import type { PublicPersona } from '../../shared/personas';

const STREET_NAMES: Partial<Record<string, string>> = {
  preflop: 'Pre-flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
};

/** Shown after each round (who won, what the AIs were thinking) and when the game ends. */
@Component({
  selector: 'app-hand-result',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hand-result.html',
  styleUrl: './hand-result.css',
})
export class HandResult {
  protected readonly client = inject(GameClient);
  private readonly now = signal(Date.now());

  protected readonly over = computed(() => this.client.state()?.phase === 'over');

  protected readonly title = computed(() => {
    const s = this.client.state();
    if (s?.result) return s.result.winner === 'humans' ? 'The humans win' : 'The AIs win';
    return `Round ${s?.table?.round ?? ''} result`;
  });

  protected readonly winners = computed(() => {
    const s = this.client.state();
    const t = s?.table;
    const outcome = t?.outcome;
    if (!s || !t || !outcome) return [];
    return outcome.awards.map((a) => {
      const p = t.players.find((x) => x.id === a.playerId)!;
      const isMe = p.id === s.you.id;
      return {
        name: isMe ? 'You' : p.name,
        isMe,
        amount: a.amount,
        hand: outcome.hands[a.playerId]?.description ?? null,
      };
    });
  });

  /** Gemini's reasoning in full; built-in moves collapsed into one line per AI. */
  protected readonly thoughtsByBot = computed(() => {
    const s = this.client.state();
    if (!s) return [];
    const ids = [...new Set(s.thoughts.map((t) => t.botId))];
    return ids
      .map((id) => {
        const mine = s.thoughts.filter((t) => t.botId === id);
        return {
          id,
          persona: s.personas[id],
          ai: mine
            .filter((t) => !t.offline)
            .map((t) => ({ ...t, label: `${STREET_NAMES[t.street] ?? t.street}: ${t.action}` })),
          builtIn: mine
            .filter((t) => t.offline)
            .map((t) => `${STREET_NAMES[t.street] ?? t.street}: ${t.action}`)
            .join(' · '),
        };
      })
      .filter((g): g is typeof g & { persona: PublicPersona } => !!g.persona);
  });

  protected readonly noAiThisRound = computed(
    () =>
      !!this.client.state()?.ai.enabled &&
      GAME_CONFIG.aiDecisions === 'after-message' &&
      this.thoughtsByBot().every((g) => g.ai.length === 0),
  );

  /** "Waiting for Alex", "Next round in 9s", or nothing (single player). */
  protected readonly readyText = computed(() => {
    const s = this.client.state();
    if (!s) return '';
    const iAmReady = s.ready.includes(s.you.id);
    const waiting = s.players.filter(
      (p) => p.connected && !s.ready.includes(p.id) && p.id !== s.you.id,
    );
    const secs = s.nextRoundAt ? Math.max(0, Math.ceil((s.nextRoundAt - this.now()) / 1000)) : null;
    const parts: string[] = [];
    if (iAmReady && waiting.length)
      parts.push(`Waiting for ${waiting.map((p) => p.name).join(', ')}`);
    if (secs !== null) parts.push(`Next round in ${secs}s`);
    return parts.join('. ');
  });

  protected readonly iAmReady = computed(() => {
    const s = this.client.state();
    return !!s && s.ready.includes(s.you.id);
  });

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 500);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
