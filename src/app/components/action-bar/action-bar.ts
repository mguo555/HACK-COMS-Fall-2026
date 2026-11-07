import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { GAME_CONFIG } from '../../game/game.config';
import { GameClient } from '../../game/game-client';

interface Preset {
  label: string;
  to: number;
}

/** Your controls on your turn, a status line otherwise, and the table announcement box. */
@Component({
  selector: 'app-action-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './action-bar.html',
  styleUrl: './action-bar.css',
})
export class ActionBar {
  protected readonly client = inject(GameClient);
  protected readonly legal = this.client.legal;
  protected readonly raiseTo = signal(0);
  protected readonly maxLength = GAME_CONFIG.maxMessageLength;
  protected readonly draft = signal('');
  /** Highlights the announce box right after you act. */
  protected readonly nudge = signal(false);
  private readonly now = signal(Date.now());
  private readonly announceBox = viewChild<ElementRef<HTMLInputElement>>('announceBox');

  protected readonly isOpening = computed(() => (this.client.table()?.currentBet ?? 0) === 0);

  protected readonly presets = computed<Preset[]>(() => {
    const legal = this.legal();
    const t = this.client.table();
    if (!legal?.canRaise || !t) return [];
    const potAfterCall = t.pot + legal.callAmount;
    const clamp = (n: number) =>
      Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round(n)));
    const presets: Preset[] = [
      { label: 'Min', to: legal.minRaiseTo },
      { label: '½ pot', to: clamp(t.currentBet + potAfterCall / 2) },
      { label: 'Pot', to: clamp(t.currentBet + potAfterCall) },
      { label: 'All-in', to: legal.maxRaiseTo },
    ];
    return presets.filter((p, i) => presets.findIndex((q) => q.to === p.to) === i);
  });

  protected readonly raiseLabel = computed(() => {
    const legal = this.legal();
    const to = this.raiseTo();
    if (legal && to >= legal.maxRaiseTo) return `All-in ${legal.maxRaiseTo}`;
    return this.isOpening() ? `Bet ${to}` : `Raise to ${to}`;
  });

  /** Seconds left on your turn. */
  protected readonly secondsLeft = computed(() => {
    const deadline = this.client.state()?.turnDeadline;
    return deadline ? Math.max(0, Math.ceil((deadline - this.now()) / 1000)) : null;
  });

  protected readonly waitingText = computed(() => {
    const s = this.client.state();
    const t = s?.table;
    const me = this.client.me();
    if (!s || !t || t.round === 0) return 'Dealing…';
    const thinking = s.thinkingBotId ? this.client.persona(s.thinkingBotId)?.name : null;
    const toAct = t.toActIndex >= 0 ? t.players[t.toActIndex] : null;
    const who = thinking ?? (toAct?.isHuman ? toAct.name : null);
    const action = thinking ? `${who} is thinking…` : who ? `Waiting for ${who}…` : 'Waiting…';
    if (me?.busted) return `You're out of chips. ${action}`;
    if (me?.folded) return `You folded. ${action}`;
    if (me?.allIn) return `You're all-in. ${action}`;
    return action;
  });

  /** Your latest announcement this round and how the table took it. */
  protected readonly myAnnouncement = computed(() => {
    const s = this.client.state();
    const round = s?.table?.round;
    return (
      [...(s?.announcements ?? [])]
        .reverse()
        .find((a) => a.fromId === s?.you.id && a.round === round) ?? null
    );
  });

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 500);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));

    // Each new decision starts the raise slider at the minimum.
    effect(() => {
      const legal = this.legal();
      if (legal?.canRaise) this.raiseTo.set(legal.minRaiseTo);
    });
  }

  protected fold(): void {
    this.acted({ type: 'fold' });
  }

  protected checkOrCall(): void {
    this.acted(this.legal()?.canCheck ? { type: 'check' } : { type: 'call' });
  }

  protected raise(): void {
    this.acted({ type: 'raise', to: this.raiseTo() });
  }

  protected setRaise(value: string | number): void {
    const legal = this.legal();
    if (!legal) return;
    const n = Math.round(Number(value));
    if (Number.isFinite(n)) {
      this.raiseTo.set(Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, n)));
    }
  }

  protected announce(box: HTMLInputElement): void {
    const text = box.value.trim();
    if (!text || this.client.state()?.announceBlocker) return;
    box.value = '';
    this.draft.set('');
    this.nudge.set(false);
    void this.client.announce(text);
  }

  protected leaningText(leaning: string | null): string {
    return leaning && leaning !== 'unchanged' ? ` · leaning ${leaning}` : '';
  }

  private acted(action: Parameters<GameClient['act']>[0]): void {
    void this.client.act(action);
    // "Announce after your action": point at the box if you still have an announcement left.
    if (!this.client.state()?.announceBlocker) {
      this.nudge.set(true);
      setTimeout(() => this.announceBox()?.nativeElement.focus(), 50);
      setTimeout(() => this.nudge.set(false), 8000);
    }
  }
}
