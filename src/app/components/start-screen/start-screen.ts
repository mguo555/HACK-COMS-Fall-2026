import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { DisplaySettings } from '../../game/display-settings';
import { GAME_CONFIG } from '../../game/game.config';
import { GameClient } from '../../game/game-client';
import { LANGUAGES, PRONOUN_SUGGESTIONS } from '../../shared/languages';
import { CHARACTERS } from '../../shared/personas';
import { HowToPlay } from '../how-to-play/how-to-play';
import type { AiStyle } from '../../shared/protocol';

const NAME_KEY = 'willaibeatus.name';
const PROFILE_KEY = 'willaibeatus.profile';

/** Title screen: start a table or join one, plus the cast. */
@Component({
  selector: 'app-start-screen',
  imports: [HowToPlay],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './start-screen.html',
  styleUrl: './start-screen.css',
})
export class StartScreen {
  protected readonly client = inject(GameClient);
  protected readonly display = inject(DisplaySettings);
  protected readonly languages = LANGUAGES;
  protected readonly pronounSuggestions = PRONOUN_SUGGESTIONS;
  protected readonly helpOpen = signal(false);
  protected readonly config = GAME_CONFIG;
  protected readonly cast = CHARACTERS;

  protected readonly name = signal(readSavedName());
  protected readonly language = signal(readProfile().language ?? browserLanguage());
  protected readonly pronouns = signal(readProfile().pronouns ?? '');
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
    void this.client.createTable(
      this.name(),
      { aiStyle: this.aiStyle(), aiSeats: this.aiSeats(), knockoutGoal: this.goal() },
      this.profile(),
    );
  }

  protected join(): void {
    if (!this.saveName() || this.code().trim().length !== 4) return;
    void this.client.joinTable(this.code(), this.name(), this.profile());
  }

  protected async forget(): Promise<void> {
    await this.client.forget(this.name());
    this.remembered.set(0);
  }

  protected num(value: string): number {
    return Number(value);
  }

  private profile() {
    const profile = { language: this.language(), pronouns: this.pronouns().trim() };
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
      // Not saved; still sent for this game.
    }
    return profile;
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

function readProfile(): { language?: string; pronouns?: string } {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** Starts on the browser's language when it's one the AIs speak. */
function browserLanguage(): string {
  const code = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return LANGUAGES.some((l) => l.code === code) ? code : 'en';
}
