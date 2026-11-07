import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { GAME_CONFIG } from '../../game/game.config';
import { GameClient } from '../../game/game-client';
import type { PlayerState } from '../../poker/engine';
import type { PublicPersona } from '../../shared/personas';
import type { ChatMessage, FeelingLabel } from '../../shared/protocol';

interface ThreadItem {
  round: number;
  messages: ChatMessage[];
}

interface Contact {
  player: PlayerState;
  persona: PublicPersona | undefined;
  isHuman: boolean;
  color: string;
  initials: string;
}

const HUMAN_COLOR = '#b18cff';
const FEELING_TEXT: Record<FeelingLabel, string> = {
  adores: 'Adores you',
  likes: 'Likes you',
  neutral: 'No strong feelings about you',
  wary: 'Wary of you',
  grudge: 'Holds a grudge against you',
};

/** Private 1:1 whispers with every other player (AIs and humans), one per player per round. */
@Component({
  selector: 'app-chat-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chat-panel.html',
  styleUrl: './chat-panel.css',
})
export class ChatPanel {
  protected readonly client = inject(GameClient);
  protected readonly maxLength = GAME_CONFIG.maxMessageLength;
  protected readonly perStreet = GAME_CONFIG.messageLimit.resetEach === 'street';

  protected readonly selectedId = signal<string | null>(null);
  private readonly drafts = signal<Record<string, string>>({});
  /** Messages from each contact you've already looked at, for unread badges. */
  private readonly seen = signal<Record<string, number>>({});

  /** Everyone at the table except you: AIs first, then other humans. */
  protected readonly contacts = computed<Contact[]>(() => {
    const s = this.client.state();
    const t = s?.table;
    if (!s || !t) return [];
    return t.players
      .filter((p) => p.id !== s.you.id)
      .map((p) => {
        const persona = this.client.persona(p.id);
        return {
          player: p,
          persona,
          isHuman: p.isHuman,
          color: persona?.color ?? HUMAN_COLOR,
          initials: persona?.initials ?? p.name.slice(0, 2).toUpperCase(),
        };
      })
      .sort((a, b) => Number(a.isHuman) - Number(b.isHuman));
  });
  protected readonly selected = computed(
    () =>
      this.contacts().find((c) => c.player.id === this.selectedId()) ??
      this.contacts().at(0) ??
      null,
  );
  /** Id of the player whose thread is open. */
  protected readonly activeId = computed(() => this.selected()?.player.id ?? null);
  protected readonly draft = computed(() => this.drafts()[this.activeId() ?? ''] ?? '');
  /** Why you can't message the selected player right now, or null if you can. */
  protected readonly blocker = computed(() => {
    const id = this.activeId();
    if (!id) return 'No one to talk to';
    const blocker = this.client.state()?.chatBlockers[id];
    return blocker === undefined ? 'Not at the table' : blocker;
  });
  protected readonly feeling = computed(() => {
    const id = this.activeId();
    const f = id ? this.client.state()?.feelings[id] : undefined;
    return f ? FEELING_TEXT[f] : null;
  });
  protected readonly mood = computed(() => {
    const id = this.activeId();
    return id ? (this.client.state()?.moods[id] ?? null) : null;
  });

  /** Messages others sent you, counted per contact. */
  private readonly received = computed(() => {
    const counts: Record<string, number> = {};
    for (const m of this.client.state()?.chat ?? []) {
      if (!m.mine && !m.pending) counts[m.withId] = (counts[m.withId] ?? 0) + 1;
    }
    return counts;
  });

  /** The selected player's thread, grouped by round. */
  protected readonly thread = computed<ThreadItem[]>(() => {
    const id = this.activeId();
    const items: ThreadItem[] = [];
    for (const m of this.client.state()?.chat ?? []) {
      if (m.withId !== id) continue;
      const last = items[items.length - 1];
      if (last?.round === m.round) last.messages.push(m);
      else items.push({ round: m.round, messages: [m] });
    }
    return items;
  });

  constructor() {
    // If the selected player leaves the table (knocked out), fall back to the first one.
    effect(() => {
      const id = this.selectedId();
      if (id && !this.contacts().some((c) => c.player.id === id)) this.selectedId.set(null);
    });
    // Whatever is on screen counts as read.
    effect(() => {
      const id = this.activeId();
      const count = id ? (this.received()[id] ?? 0) : 0;
      if (id && (this.seen()[id] ?? 0) !== count) {
        this.seen.update((s) => ({ ...s, [id]: count }));
      }
    });
  }

  protected unread(id: string): number {
    return Math.max(0, (this.received()[id] ?? 0) - (this.seen()[id] ?? 0));
  }

  protected status(c: Contact): { text: string; tone: 'ok' | 'used' | 'off' } {
    const s = this.client.state();
    if (!s) return { text: '', tone: 'off' };
    if (!c.isHuman && c.player.busted) return { text: 'Out', tone: 'off' };
    if (!c.isHuman && c.player.folded) return { text: 'Folded', tone: 'off' };
    const left = s.messagesLeft[c.player.id] ?? 0;
    return left > 0 ? { text: `${left} left`, tone: 'ok' } : { text: 'Sent', tone: 'used' };
  }

  protected setDraft(value: string): void {
    const id = this.activeId();
    if (id) this.drafts.update((d) => ({ ...d, [id]: value.slice(0, this.maxLength) }));
  }

  protected onKeydown(event: KeyboardEvent, box: HTMLTextAreaElement): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send(box);
    }
  }

  protected send(box: HTMLTextAreaElement): void {
    const id = this.activeId();
    const text = box.value.trim();
    if (!id || !text || this.blocker()) return;
    this.drafts.update((d) => ({ ...d, [id]: '' }));
    // Clear the element too: typing and pressing Enter can land before the next render.
    box.value = '';
    void this.client.sendMessage(id, text);
  }

  protected leaningText(leaning: string | null | undefined): string {
    return leaning && leaning !== 'unchanged' ? `, leaning ${leaning}` : '';
  }
}
