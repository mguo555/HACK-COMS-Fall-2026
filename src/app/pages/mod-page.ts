import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { api, errorMessage, imageUrl } from '../api';
import { Notice } from '../session';
import { formatDay } from '../shared/days';
import type { ModItem } from '../shared/protocol';

/** For admins (ADMIN_EMAILS on the server): reported photos, with keep, remove and ban. */
@Component({
  selector: 'app-mod-page',
  imports: [RouterLink],
  template: `
    <h1 class="page-title">Mod queue</h1>
    <p class="lede">
      Reported photos land here. Enough reports hide a photo until you decide. Keeping it puts it
      back and stops further reports from hiding it again.
    </p>

    @if (error(); as message) {
      <div class="empty gap">{{ message }}</div>
    } @else if (items(); as items) {
      <ul class="queue">
        @for (item of items; track item.post.id) {
          <li class="item">
            <a class="pic" [href]="full(item.post.id)" target="_blank" rel="noopener">
              <img [src]="thumb(item.post.id)" alt="Reported photo" />
            </a>
            <div class="info">
              <p>
                <a [routerLink]="['/u', item.post.handle]">{{ item.post.handle }}</a>
                <span class="muted"> · {{ item.email }}</span>
              </p>
              <p class="muted">{{ day(item.post.day) }} · {{ item.theme }}</p>
              <p>
                <b>{{ item.reports }} {{ item.reports === 1 ? 'report' : 'reports' }}</b>
                · {{ item.post.status === 'hidden' ? 'hidden' : 'still up' }}
              </p>
              <div class="buttons">
                <button
                  type="button"
                  class="btn btn-sm"
                  [disabled]="busy()"
                  (click)="act(item, 'keep')"
                >
                  Keep it
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-danger"
                  [disabled]="busy()"
                  (click)="act(item, 'remove')"
                >
                  Take down
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-danger"
                  [disabled]="busy()"
                  (click)="ban(item)"
                >
                  Ban {{ item.post.handle }}
                </button>
              </div>
            </div>
          </li>
        } @empty {
          <li class="empty">Nothing reported. Quiet day in the garden.</li>
        }
      </ul>
    }
  `,
  styles: `
    .gap {
      margin-top: 32px;
    }
    .queue {
      display: grid;
      gap: 14px;
      margin: 28px 0 0;
      padding: 0;
      list-style: none;
    }
    .item {
      display: flex;
      gap: 16px;
      padding: 14px;
      border: 1.5px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface);
    }
    .pic {
      flex: none;
      width: 120px;
      height: 150px;
      border-radius: 10px;
      overflow: hidden;
      background: var(--surface-2);
    }
    .pic img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .info {
      display: grid;
      align-content: start;
      gap: 4px;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }
    @media (max-width: 480px) {
      .item {
        flex-direction: column;
      }
      .pic {
        width: 100%;
        height: 240px;
      }
    }
  `,
})
export class ModPage {
  private readonly notice = inject(Notice);
  protected readonly items = signal<ModItem[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    this.load();
  }

  private async load(): Promise<void> {
    try {
      this.items.set((await api.modQueue()).items);
    } catch (error) {
      this.error.set(errorMessage(error));
    }
  }

  protected thumb(id: string): string {
    return imageUrl(id, 'thumb');
  }

  protected full(id: string): string {
    return imageUrl(id, 'full');
  }

  protected day(date: string): string {
    return formatDay(date, 'short');
  }

  protected act(item: ModItem, action: 'keep' | 'remove'): Promise<void> {
    return this.run(
      () => api.moderate(item.post.id, action),
      action === 'keep' ? 'Kept. It’s back on the board.' : 'Taken down.',
    );
  }

  protected ban(item: ModItem): Promise<void> {
    const handle = item.post.handle;
    if (!confirm(`Ban ${handle}? This takes down all their photos and signs them out.`)) {
      return Promise.resolve();
    }
    return this.run(() => api.ban(handle), `${handle} is banned.`);
  }

  private async run(task: () => Promise<unknown>, done: string): Promise<void> {
    this.busy.set(true);
    try {
      await task();
      this.notice.show(done);
      await this.load();
    } catch (error) {
      this.notice.show(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
