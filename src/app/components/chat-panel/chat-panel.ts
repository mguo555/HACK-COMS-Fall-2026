import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { PERSONAS, PersonaInfo } from '../../ai/personas';
import { GAME_CONFIG } from '../../game/game.config';
import { ChatMessage, GameService } from '../../game/game.service';

interface ThreadItem {
  round: number;
  messages: ChatMessage[];
}

/** Private 1:1 chats with each AI player, limited to one message per player per round. */
@Component({
  selector: 'app-chat-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chat-panel.html',
  styleUrl: './chat-panel.css',
})
export class ChatPanel {
  protected readonly game = inject(GameService);
  protected readonly personas = PERSONAS;
  protected readonly maxLength = GAME_CONFIG.maxMessageLength;
  protected readonly perStreet = GAME_CONFIG.messageLimit.resetEach === 'street';

  protected readonly selectedId = signal(PERSONAS[0].id);
  private readonly drafts = signal<Record<string, string>>({});

  protected readonly selected = computed(
    () => PERSONAS.find((p) => p.id === this.selectedId()) ?? PERSONAS[0],
  );
  protected readonly draft = computed(() => this.drafts()[this.selectedId()] ?? '');
  protected readonly blocker = computed(() => this.game.messageBlocker(this.selectedId()));

  /** The selected bot's messages, grouped by round. */
  protected readonly thread = computed<ThreadItem[]>(() => {
    const items: ThreadItem[] = [];
    for (const m of this.game.chat()) {
      if (m.botId !== this.selectedId()) continue;
      const last = items[items.length - 1];
      if (last?.round === m.round) last.messages.push(m);
      else items.push({ round: m.round, messages: [m] });
    }
    return items;
  });

  protected status(p: PersonaInfo): { text: string; tone: 'ok' | 'used' | 'off' } {
    const player = this.game.table()?.players.find((x) => x.id === p.id);
    if (!player || player.busted) return { text: 'Out', tone: 'off' };
    if (player.folded) return { text: 'Folded', tone: 'off' };
    const left = this.game.messagesLeft(p.id);
    return left > 0 ? { text: `${left} left`, tone: 'ok' } : { text: 'Sent', tone: 'used' };
  }

  protected select(id: string): void {
    this.selectedId.set(id);
  }

  protected setDraft(value: string): void {
    const id = this.selectedId();
    this.drafts.update((d) => ({ ...d, [id]: value.slice(0, this.maxLength) }));
  }

  protected onKeydown(event: KeyboardEvent, box: HTMLTextAreaElement): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send(box);
    }
  }

  protected send(box: HTMLTextAreaElement): void {
    const id = this.selectedId();
    const text = box.value.trim();
    if (!text || this.blocker()) return;
    this.drafts.update((d) => ({ ...d, [id]: '' }));
    // Clear the element too: typing and pressing Enter can land before the next render.
    box.value = '';
    void this.game.sendMessage(id, text);
  }
}
