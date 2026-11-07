import { Injectable, effect, signal } from '@angular/core';

const KEY = 'willaibeatus.display';

/**
 * Per-viewer accessibility options, saved in this browser:
 * - fourColorDeck: diamonds blue and clubs green, so suits don't rely on red vs black.
 * - largeText: scales the whole page up.
 * Reduced motion follows the operating system setting (see styles.css).
 */
@Injectable({ providedIn: 'root' })
export class DisplaySettings {
  readonly fourColorDeck = signal(false);
  readonly largeText = signal(false);

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
      this.fourColorDeck.set(!!saved.fourColorDeck);
      this.largeText.set(!!saved.largeText);
    } catch {
      // No storage: defaults.
    }
    effect(() => {
      const root = document.documentElement;
      root.dataset['deck'] = this.fourColorDeck() ? 'four' : 'two';
      root.dataset['text'] = this.largeText() ? 'large' : 'normal';
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify({ fourColorDeck: this.fourColorDeck(), largeText: this.largeText() }),
        );
      } catch {
        // Not saved; still applied for this visit.
      }
    });
  }
}
