import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { GameClient } from '../../game/game-client';

/** Running list of deals, actions, table talk and results. */
@Component({
  selector: 'app-game-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel log">
      <h2>Table log</h2>
      <div class="scroll">
        <ol>
          @for (e of entries(); track e.id) {
            <li [attr.data-kind]="e.kind">{{ e.text }}</li>
          } @empty {
            <li class="muted">The log fills in once cards are dealt.</li>
          }
        </ol>
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-height: 0;
    }
    .log {
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: 12px 14px;
    }
    h2 {
      margin-bottom: 6px;
      color: var(--muted);
      font-size: 12px;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    /* column-reverse keeps the newest entry in view */
    .scroll {
      display: flex;
      flex: 1;
      flex-direction: column-reverse;
      min-height: 0;
      overflow-y: auto;
    }
    ol {
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: 13px;
    }
    li {
      padding: 2px 0;
      color: #c9d1e0;
    }
    li[data-kind='round'] {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-weight: 700;
    }
    li[data-kind='deal'] {
      color: #9fdcbf;
      font-weight: 600;
    }
    li[data-kind='talk'] {
      color: var(--text);
      font-style: italic;
    }
    li[data-kind='result'] {
      color: var(--gold);
      font-weight: 600;
    }
  `,
})
export class GameLog {
  private readonly client = inject(GameClient);

  /** The last few rounds only, to keep the DOM small. */
  protected readonly entries = computed(() => {
    const t = this.client.table();
    if (!t) return [];
    return t.log.filter((e) => e.round >= t.round - 2);
  });
}
