import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AiService } from '../../ai/ai.service';
import { PERSONAS } from '../../ai/personas';
import { GAME_CONFIG } from '../../game/game.config';
import { GameService } from '../../game/game.service';
import { forgetHistory, loadHistory } from '../../game/player-history';

const NAME_KEY = 'willaibeatus.name';

/** Title screen: rules, the opponents, and a name field. */
@Component({
  selector: 'app-start-screen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './start-screen.html',
  styleUrl: './start-screen.css',
})
export class StartScreen {
  protected readonly game = inject(GameService);
  protected readonly ai = inject(AiService);
  protected readonly personas = PERSONAS;
  protected readonly config = GAME_CONFIG;
  protected readonly name = signal(readSavedName());
  private readonly forgetCount = signal(0);

  /** Rounds the bots remember for this name, from earlier games on this device. */
  protected readonly remembered = computed(() => {
    this.forgetCount();
    return loadHistory(this.name())?.rounds ?? 0;
  });

  protected forget(): void {
    forgetHistory(this.name());
    this.forgetCount.update((n) => n + 1);
  }

  protected start(): void {
    const name = this.name().trim() || 'Player';
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      // Storage can be unavailable (private mode); the name just isn't remembered.
    }
    void this.game.startGame(name);
  }
}

function readSavedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
