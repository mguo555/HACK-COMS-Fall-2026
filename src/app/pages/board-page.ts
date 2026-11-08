import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { ApiError, api, errorMessage } from '../api';
import { Likes, Notice, Session } from '../session';
import { formatDay } from '../shared/days';
import type { DayInfo, MyPost, Post } from '../shared/protocol';
import { Lightbox } from '../ui/lightbox';
import { PostGrid } from '../ui/post-grid';
import { ThemeTag } from '../ui/theme-tag';
import { Uploader } from '../ui/uploader';

type Sort = 'new' | 'top';

/** Today's board (route '') or a past day's (route 'day/:date'). */
@Component({
  selector: 'app-board-page',
  imports: [RouterLink, ThemeTag, Uploader, PostGrid, Lightbox],
  templateUrl: './board-page.html',
  styleUrl: './board-page.css',
})
export class BoardPage {
  /** From the 'day/:date' route. Undefined means today. */
  readonly date = input<string>();

  protected readonly session = inject(Session);
  private readonly likes = inject(Likes);
  private readonly notice = inject(Notice);
  private readonly router = inject(Router);
  private readonly title = inject(Title);

  protected readonly state = signal<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  protected readonly error = signal('');
  protected readonly day = signal<DayInfo | null>(null);
  protected readonly isToday = signal(false);
  protected readonly posts = signal<Post[]>([]);
  protected readonly mine = signal<MyPost | null>(null);
  protected readonly sort = signal<Sort>('new');
  protected readonly openIndex = signal<number | null>(null);

  // "Top" order is frozen when you pick it, so photos don't jump around as you like them.
  private readonly topOrder = signal(new Map<string, number>());

  protected readonly sorted = computed(() => {
    const posts = this.posts();
    if (this.sort() === 'new') return posts;
    const order = this.topOrder();
    const rank = (p: Post) => order.get(p.id) ?? -1;
    return [...posts].sort((a, b) => rank(a) - rank(b));
  });

  private loadCount = 0;

  constructor() {
    effect(() => {
      const date = this.date() ?? 'today';
      const today = this.session.today()?.date;
      this.session.user(); // reload after signing in or out
      if (today) untracked(() => this.load(date));
    });
  }

  private async load(date: string): Promise<void> {
    const id = ++this.loadCount;
    this.openIndex.set(null);
    if (!this.session.canView()) {
      this.state.set('signed-out');
      return;
    }
    try {
      const board = await api.board(date);
      if (id !== this.loadCount) return;
      if (date !== 'today' && board.isToday) {
        this.router.navigate(['/'], { replaceUrl: true });
        return;
      }
      const newDay = this.day()?.date !== board.day.date;
      this.day.set(board.day);
      this.isToday.set(board.isToday);
      this.posts.set(board.posts);
      this.mine.set(board.mine);
      if (newDay) this.setSort(board.isToday ? 'new' : 'top');
      else if (this.sort() === 'top') this.setSort('top');
      this.state.set('ready');
      this.title.setTitle(
        board.isToday
          ? 'TheDailyStalk'
          : `${board.day.theme} (${formatDay(board.day.date, 'short')}) · TheDailyStalk`,
      );
    } catch (error) {
      if (id !== this.loadCount) return;
      if (error instanceof ApiError && error.status === 401) {
        this.state.set('signed-out');
      } else {
        this.error.set(errorMessage(error));
        this.state.set('error');
      }
    }
  }

  protected retry(): void {
    this.load(this.date() ?? 'today');
  }

  protected setSort(sort: Sort): void {
    if (sort === 'top') {
      const ranked = [...this.posts()].sort(
        (a, b) => b.likes - a.likes || a.createdAt - b.createdAt,
      );
      this.topOrder.set(new Map(ranked.map((p, i) => [p.id, i])));
    }
    this.sort.set(sort);
  }

  protected like(post: Post): void {
    this.likes.toggle(this.posts, post);
  }

  protected posted(post: MyPost): void {
    this.mine.set(post);
    this.posts.update((posts) => [post, ...posts]);
    if (this.sort() === 'top') this.setSort('top');
    this.notice.show('You’re on the board. See you tomorrow.');
  }

  protected openMine(): void {
    const index = this.sorted().findIndex((p) => p.mine);
    if (index >= 0) this.openIndex.set(index);
  }

  protected removed(post: Post): void {
    this.openIndex.set(null);
    this.posts.update((posts) => posts.filter((p) => p.id !== post.id));
    if (post.mine) this.mine.update((m) => m && { ...m, status: 'deleted' });
  }
}
