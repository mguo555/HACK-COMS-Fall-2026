import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { GAME_CONFIG } from '../../game/game.config';
import { GameClient } from '../../game/game-client';
import { CHARACTERS } from '../../shared/personas';
import type { AiStyle } from '../../shared/protocol';

const NAME_KEY = 'willaibeatus.name';

/** Title screen: start a table or join one, plus the cast. */
@Component({
  selector: 'app-start-screen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './start-screen.html',
  styleUrl: './start-screen.css',
})
export class StartScreen {
  protected readonly client = inject(GameClient);
  protected readonly config = GAME_CONFIG;
  protected readonly cast = CHARACTERS;

  protected readonly name = signal(readSavedName());
  protected readonly code = signal(this.client.invitedCode());
  protected readonly aiStyle = signal<AiStyle>('characters');
  protected readonly aiSeats = signal(GAME_CONFIG.defaultAiSeats);
  protected readonly goal = signal(GAME_CONFIG.defaultKnockoutGoal);
  protected readonly remembered = signal(0);
  protected readonly seatOptions = [2, 3, 4, 5];
  protected readonly goalOptions = [3, 5, 8, 12];

  constructor() {
    // Look up what the bots remember about this name (debounced while typing).
    let timer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const name = this.name().trim();
      clearTimeout(timer);
      timer = setTimeout(
        async () => this.remembered.set(name ? await this.client.rememberedRounds(name) : 0),
        400,
      );
    });
  }

  protected create(): void {
    if (!this.saveName()) return;
    void this.client.createTable(this.name(), {
      aiStyle: this.aiStyle(),
      aiSeats: this.aiSeats(),
      knockoutGoal: this.goal(),
    });
  }

  protected join(): void {
    if (!this.saveName() || this.code().trim().length !== 4) return;
    void this.client.joinTable(this.code(), this.name());
  }

  protected async forget(): Promise<void> {
    await this.client.forget(this.name());
    this.remembered.set(0);
  }

  protected num(value: string): number {
    return Number(value);
  }

  private saveName(): boolean {
    const name = this.name().trim();
    if (!name) {
      this.client.error.set('Pick a name first.');
      return false;
    }
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      // Storage unavailable: the name just isn't remembered.
    }
    return true;
  }
}

function readSavedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
