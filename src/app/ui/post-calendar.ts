import { Component, computed, input, output } from '@angular/core';
import { imageUrl } from '../api';
import { formatDay } from '../shared/days';
import type { CalendarDay } from '../shared/protocol';

interface Cell {
  date: string;
  num: number;
  status: CalendarDay['status'] | null;
  id: string | null;
  today: boolean;
  future: boolean;
}

interface Month {
  key: string;
  label: string;
  posted: number;
  /** Null cells pad the first week so day 1 lands on the right weekday. */
  cells: (Cell | null)[];
}

const MAX_MONTHS = 12;

/** Month grids marking the days someone posted (with that day's photo) or deleted a post. */
@Component({
  selector: 'app-post-calendar',
  template: `
    <div class="months">
      @for (month of months(); track month.key) {
        <section class="month">
          <h3>
            {{ month.label }}
            <small>{{ month.posted }} {{ month.posted === 1 ? 'photo' : 'photos' }}</small>
          </h3>
          <div class="grid">
            @for (name of weekdays; track $index) {
              <span class="wd" aria-hidden="true">{{ name }}</span>
            }
            @for (cell of month.cells; track $index) {
              @if (!cell) {
                <span></span>
              } @else if (cell.status === 'posted' && cell.id) {
                <button
                  type="button"
                  class="cell posted"
                  [class.today]="cell.today"
                  [attr.aria-label]="describe(cell)"
                  (click)="open.emit(cell.id)"
                >
                  <img [src]="thumb(cell.id)" alt="" loading="lazy" />
                  <span class="num">{{ cell.num }}</span>
                </button>
              } @else {
                <span
                  class="cell"
                  [class.deleted]="cell.status === 'deleted'"
                  [class.removed]="cell.status === 'removed'"
                  [class.today]="cell.today"
                  [class.future]="cell.future"
                  [attr.title]="cell.status ? describe(cell) : null"
                  >{{ cell.num }}</span
                >
              }
            }
          </div>
        </section>
      }
    </div>
    <ul class="legend">
      <li><i class="key posted"></i> Posted</li>
      @if (showPrivate()) {
        <li><i class="key deleted"></i> Deleted</li>
        @if (hasRemoved()) {
          <li><i class="key removed"></i> Taken down by a mod</li>
        }
      }
      <li><i class="key today"></i> Today</li>
    </ul>
  `,
  styles: `
    .months {
      display: flex;
      flex-wrap: wrap;
      gap: 28px 40px;
    }
    .month {
      flex: 0 1 420px;
      min-width: 0;
    }
    h3 {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 10px;
      font-size: 18px;
    }
    h3 small {
      color: var(--faint);
      font-family: var(--font);
      font-size: 13px;
      font-weight: 500;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 4px;
    }
    .wd {
      color: var(--faint);
      font-size: 11px;
      font-weight: 700;
      text-align: center;
    }
    .cell {
      position: relative;
      display: grid;
      place-items: center;
      aspect-ratio: 1;
      padding: 0;
      border: 0;
      border-radius: 10px;
      background: var(--surface-2);
      color: var(--muted);
      font-size: 13px;
      font-weight: 600;
      overflow: hidden;
    }
    .cell.future {
      background: transparent;
      color: var(--faint);
      opacity: 0.6;
    }
    .posted {
      cursor: zoom-in;
      background: var(--leaf);
    }
    .posted img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .posted .num {
      position: relative;
      color: #fff;
      text-shadow: 0 1px 3px rgb(0 0 0 / 70%);
    }
    .posted:hover img {
      filter: brightness(1.1);
    }
    .deleted {
      background: transparent;
      outline: 2px dashed var(--pot);
      outline-offset: -2px;
      color: var(--pot);
      text-decoration: line-through;
    }
    .removed {
      background: repeating-linear-gradient(45deg, var(--surface-2) 0 4px, var(--line) 4px 8px);
      color: var(--faint);
    }
    .today {
      box-shadow:
        0 0 0 2px var(--bg),
        0 0 0 4px var(--leaf-bright);
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 18px;
      margin: 18px 0 0;
      padding: 0;
      list-style: none;
      color: var(--muted);
      font-size: 13px;
    }
    .key {
      display: inline-block;
      width: 14px;
      height: 14px;
      margin-right: 4px;
      border-radius: 4px;
      vertical-align: -2px;
    }
    .key.posted {
      background: var(--leaf);
    }
    .key.today {
      box-shadow: inset 0 0 0 2px var(--leaf-bright);
    }
  `,
})
export class PostCalendar {
  readonly days = input.required<CalendarDay[]>();
  readonly today = input.required<string>();
  /** The first day to show (usually when the account was made). */
  readonly since = input.required<string>();
  /** Show the legend for deleted and taken-down days (your own profile). */
  readonly showPrivate = input(false);
  /** A posted day was clicked; carries the photo id. */
  readonly open = output<string>();

  protected readonly weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  protected readonly hasRemoved = computed(() => this.days().some((d) => d.status === 'removed'));

  protected readonly months = computed(() => {
    const byDay = new Map(this.days().map((d) => [d.day, d]));
    const today = this.today();
    const since = this.since() < today ? this.since() : today;
    let [y, m] = today.split('-').map(Number);
    const [sy, sm] = since.split('-').map(Number);
    const months: Month[] = [];
    while (months.length < MAX_MONTHS) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
      const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const cells: (Cell | null)[] = new Array(lead).fill(null);
      let posted = 0;
      for (let d = 1; d <= length; d++) {
        const date = `${key}-${String(d).padStart(2, '0')}`;
        const entry = byDay.get(date);
        if (entry?.status === 'posted') posted++;
        cells.push({
          date,
          num: d,
          status: entry?.status ?? null,
          id: entry?.id ?? null,
          today: date === today,
          future: date > today,
        });
      }
      months.push({
        key,
        label: new Intl.DateTimeFormat('en-US', {
          timeZone: 'UTC',
          month: 'long',
          year: 'numeric',
        }).format(Date.UTC(y, m - 1, 1)),
        posted,
        cells,
      });
      if (y < sy || (y === sy && m <= sm)) break;
      m--;
      if (m === 0) {
        m = 12;
        y--;
      }
    }
    return months;
  });

  protected thumb(id: string): string {
    return imageUrl(id, 'thumb');
  }

  protected describe(cell: Cell): string {
    const day = formatDay(cell.date);
    if (cell.status === 'posted') return `${day}: posted. Open the photo.`;
    if (cell.status === 'deleted') return `${day}: posted, then deleted`;
    return `${day}: taken down by a mod`;
  }
}
