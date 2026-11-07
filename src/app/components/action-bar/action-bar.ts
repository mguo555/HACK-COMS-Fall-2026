import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { personaById } from '../../ai/personas';
import { GameService } from '../../game/game.service';

interface Preset {
  label: string;
  to: number;
}

/** The human's controls on their turn, and a status line otherwise. */
@Component({
  selector: 'app-action-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './action-bar.html',
  styleUrl: './action-bar.css',
})
export class ActionBar {
  protected readonly game = inject(GameService);
  protected readonly raiseTo = signal(0);

  protected readonly legal = this.game.legal;

  /** Bet vs raise wording depends on whether anyone has bet this street. */
  protected readonly isOpening = computed(() => (this.game.table()?.currentBet ?? 0) === 0);

  protected readonly presets = computed<Preset[]>(() => {
    const legal = this.legal();
    const t = this.game.table();
    if (!legal?.canRaise || !t) return [];
    const toCall = legal.callAmount;
    const potAfterCall = t.pot + toCall;
    const clamp = (n: number) =>
      Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round(n)));
    const presets: Preset[] = [
      { label: 'Min', to: legal.minRaiseTo },
      { label: '½ pot', to: clamp(t.currentBet + potAfterCall / 2) },
      { label: 'Pot', to: clamp(t.currentBet + potAfterCall) },
      { label: 'All-in', to: legal.maxRaiseTo },
    ];
    // Drop presets that land on the same amount as an earlier one.
    return presets.filter((p, i) => presets.findIndex((q) => q.to === p.to) === i);
  });

  protected readonly raiseLabel = computed(() => {
    const legal = this.legal();
    const to = this.raiseTo();
    if (legal && to >= legal.maxRaiseTo) return `All-in ${legal.maxRaiseTo}`;
    return this.isOpening() ? `Bet ${to}` : `Raise to ${to}`;
  });

  protected readonly waitingText = computed(() => {
    const t = this.game.table();
    const me = this.game.human();
    if (!t || t.round === 0) return 'Dealing…';
    const thinking = this.game.thinkingBotId();
    const name = thinking ? personaById(thinking)?.name : null;
    if (me?.folded)
      return name
        ? `You folded. ${name} is thinking…`
        : 'You folded. Watching the rest of the round.';
    if (me?.allIn) return name ? `You're all-in. ${name} is thinking…` : "You're all-in.";
    return name ? `${name} is thinking…` : 'Waiting…';
  });

  constructor() {
    // Each new decision starts the raise slider at the minimum.
    effect(() => {
      const legal = this.legal();
      if (legal?.canRaise) this.raiseTo.set(legal.minRaiseTo);
    });
  }

  protected fold(): void {
    this.game.act({ type: 'fold' });
  }

  protected checkOrCall(): void {
    this.game.act(this.legal()?.canCheck ? { type: 'check' } : { type: 'call' });
  }

  protected raise(): void {
    this.game.act({ type: 'raise', to: this.raiseTo() });
  }

  protected setRaise(value: string | number): void {
    const legal = this.legal();
    if (!legal) return;
    const n = Math.round(Number(value));
    if (Number.isFinite(n))
      this.raiseTo.set(Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, n)));
  }
}
