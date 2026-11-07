import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AiService } from '../../ai/ai.service';
import { PERSONAS } from '../../ai/personas';
import { GAME_CONFIG } from '../../game/game.config';
import { GameService } from '../../game/game.service';

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
