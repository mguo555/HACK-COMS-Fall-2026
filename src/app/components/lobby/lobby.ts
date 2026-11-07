import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { GAME_CONFIG } from '../../game/game.config';
import { GameClient } from '../../game/game-client';

/** Waiting room: the table code to share, who has joined, and the host's Start button. */
@Component({
  selector: 'app-lobby',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (client.state(); as s) {
      <main class="lobby">
        <section class="panel card">
          <p class="eyebrow">Table code</p>
          <p class="code">{{ s.code }}</p>
          <p class="muted">Friends on your network can open this link, or enter the code:</p>
          <div class="link">
            <input class="field" readonly [value]="client.inviteLink()" aria-label="Invite link" />
            <button class="btn btn-sm" (click)="copy()">{{ copied() ? 'Copied' : 'Copy' }}</button>
          </div>

          <h2>At the table ({{ s.players.length }}/{{ maxHumans }})</h2>
          <ul class="players">
            @for (p of s.players; track p.id) {
              <li>
                <span class="dot" [class.on]="p.connected"></span>
                {{ p.name }}
                @if (p.id === s.you.id) {
                  <span class="muted">(you)</span>
                }
                @if (p.isHost) {
                  <span class="pill">Host</span>
                }
              </li>
            }
          </ul>

          <p class="muted settings">
            {{ s.settings.aiStyle === 'gemini' ? 'Base Gemini players' : 'Characters' }} ·
            {{ aiSeats() }} AI {{ aiSeats() === 1 ? 'player' : 'players' }} · knock out
            {{ s.settings.knockoutGoal }} to win
          </p>

          <div class="actions">
            @if (s.you.isHost) {
              <button class="btn btn-primary" (click)="client.start()" [disabled]="client.busy()">
                Start the game
              </button>
            } @else {
              <span class="muted">Waiting for the host to start…</span>
            }
            <button class="btn btn-ghost" (click)="client.leave()">Leave</button>
          </div>
          @if (client.error(); as error) {
            <p class="error" role="alert">{{ error }}</p>
          }
        </section>
      </main>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .lobby {
      display: grid;
      place-items: center;
      min-height: 100vh;
      padding: 24px 16px;
    }
    .card {
      display: grid;
      gap: 10px;
      width: min(520px, 100%);
      padding: 24px;
    }
    .eyebrow {
      margin: 0;
      color: var(--gold);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }
    .code {
      margin: 0;
      font-family: var(--mono);
      font-size: 56px;
      font-weight: 800;
      letter-spacing: 10px;
    }
    .link {
      display: flex;
      gap: 8px;
    }
    .field {
      flex: 1;
      min-width: 0;
      height: 36px;
      padding: 0 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel-2);
      font-size: 13px;
    }
    h2 {
      margin-top: 10px;
      font-size: 15px;
    }
    .players {
      display: grid;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .players li {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--faint);
    }
    .dot.on {
      background: var(--success);
    }
    .settings {
      margin: 6px 0 0;
      font-size: 13px;
    }
    .actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-top: 8px;
    }
    .error {
      margin: 0;
      color: var(--danger);
      font-size: 14px;
    }
  `,
})
export class Lobby {
  protected readonly client = inject(GameClient);
  protected readonly maxHumans = GAME_CONFIG.maxHumans;
  protected readonly copied = signal(false);

  /** AI seats shrink if humans fill the table. */
  protected readonly aiSeats = computed(() => {
    const s = this.client.state();
    return s ? Math.min(s.settings.aiSeats, GAME_CONFIG.maxSeats - s.players.length) : 0;
  });

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.client.inviteLink());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      // Clipboard needs HTTPS or localhost; the link is selectable in the box anyway.
    }
  }
}
