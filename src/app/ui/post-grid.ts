import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { imageUrl } from '../api';
import { formatDay } from '../shared/days';
import type { Post, PostStatus } from '../shared/protocol';
import { Flower } from './flower';
import { handleColor, timeAgo } from './format';
import { LikeButton } from './like-button';

export type GridPost = Post & { theme?: string; status?: PostStatus };

interface Placed {
  post: GridPost;
  /** Position in `posts`, which is what `open` reports. */
  index: number;
}

// Photos keep their shape, within limits, so a panorama or a tall shot doesn't take over.
const WIDEST = 4 / 3;
const TALLEST = 3 / 4;

/**
 * Masonry columns. Photos go one at a time into the shortest column, so the first row still
 * reads left to right in the list's order.
 */
@Component({
  selector: 'app-post-grid',
  imports: [RouterLink, LikeButton, Flower],
  templateUrl: './post-grid.html',
  styleUrl: './post-grid.css',
})
export class PostGrid {
  readonly posts = input.required<GridPost[]>();
  /** Label each photo with its day and theme instead of who posted it (profile pages). */
  readonly showDay = input(false);
  readonly canLike = input(false);
  /** The photo of the day, which gets a badge. */
  readonly topId = input<string | null>(null);
  readonly open = output<number>();
  readonly like = output<GridPost>();

  private readonly width = signal(window.innerWidth);
  private readonly now = signal(Date.now());

  protected readonly columns = computed(() => {
    const w = this.width();
    return w >= 1000 ? 4 : w >= 700 ? 3 : 2;
  });

  protected readonly stacks = computed(() => {
    const n = this.columns();
    const stacks: Placed[][] = Array.from({ length: n }, () => []);
    const heights: number[] = new Array(n).fill(0);
    this.posts().forEach((post, index) => {
      let shortest = 0;
      for (let i = 1; i < n; i++) if (heights[i] < heights[shortest] - 0.01) shortest = i;
      stacks[shortest].push({ post, index });
      // Height in column widths: the photo plus roughly the name row under it.
      heights[shortest] += 1 / this.ratio(post) + 0.25;
    });
    return stacks;
  });

  constructor() {
    const resize = () => this.width.set(window.innerWidth);
    window.addEventListener('resize', resize, { passive: true });
    const timer = setInterval(() => this.now.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('resize', resize);
      clearInterval(timer);
    });
  }

  protected ratio(post: Post): number {
    return Math.min(WIDEST, Math.max(TALLEST, post.width / post.height));
  }

  protected thumb(id: string): string {
    return imageUrl(id, 'thumb');
  }

  protected color(handle: string): string {
    return handleColor(handle);
  }

  protected when(ms: number): string {
    return timeAgo(ms, this.now());
  }

  protected shortDay(day: string): string {
    return formatDay(day, 'short');
  }

  /** Cards sprout in one after another, but don't make anyone wait long. */
  protected delay(index: number): number {
    return Math.min(index, 12) * 45;
  }

  protected loaded(event: Event): void {
    (event.target as HTMLElement).classList.add('loaded');
  }
}
