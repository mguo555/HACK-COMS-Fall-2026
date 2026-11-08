import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { imageUrl } from '../api';
import { formatDay } from '../shared/days';
import type { Post, PostStatus } from '../shared/protocol';
import { LikeButton } from './like-button';

export type GridPost = Post & { theme?: string; status?: PostStatus };

@Component({
  selector: 'app-post-grid',
  imports: [RouterLink, LikeButton],
  template: `
    <ul class="grid">
      @for (post of posts(); track post.id; let i = $index) {
        <li class="card">
          <button type="button" class="photo" (click)="open.emit(i)">
            <img
              [src]="thumb(post.id)"
              [alt]="'Photo by ' + post.handle"
              loading="lazy"
              decoding="async"
            />
            @if (post.status === 'hidden') {
              <span class="badge">Under review</span>
            }
          </button>
          <div class="meta">
            @if (showDay()) {
              <span class="day">
                <b>{{ shortDay(post.day) }}</b>
                <span>{{ post.theme }}</span>
              </span>
            } @else {
              <a class="who" [routerLink]="['/u', post.handle]">{{ post.handle }}</a>
            }
            <app-like-button
              [count]="post.likes"
              [liked]="post.liked"
              [disabled]="!canLike() || post.mine"
              (toggle)="like.emit(post)"
            />
          </div>
        </li>
      }
    </ul>
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 18px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .card {
      min-width: 0;
    }
    .photo {
      position: relative;
      display: block;
      width: 100%;
      padding: 0;
      border: 0;
      border-radius: 12px;
      overflow: hidden;
      background: var(--surface-2);
      aspect-ratio: 4 / 5;
      cursor: zoom-in;
    }
    .photo img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 0.3s ease;
    }
    .photo:hover img {
      transform: scale(1.03);
    }
    .badge {
      position: absolute;
      left: 8px;
      top: 8px;
      padding: 2px 10px;
      border-radius: 999px;
      background: var(--ink);
      color: var(--bg);
      font-size: 12px;
      font-weight: 600;
    }
    .meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 4px 0 0 2px;
    }
    .who {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--ink);
      font-weight: 600;
      font-size: 15px;
      text-decoration: none;
    }
    .who:hover {
      color: var(--leaf);
    }
    .day {
      display: grid;
      min-width: 0;
      font-size: 13px;
      line-height: 1.3;
      color: var(--muted);
    }
    .day b {
      color: var(--ink);
    }
    .day span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    @media (max-width: 560px) {
      .grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
    }
  `,
})
export class PostGrid {
  readonly posts = input.required<GridPost[]>();
  /** Label each photo with its day and theme instead of who posted it (profile pages). */
  readonly showDay = input(false);
  readonly canLike = input(false);
  readonly open = output<number>();
  readonly like = output<GridPost>();

  protected thumb(id: string): string {
    return imageUrl(id, 'thumb');
  }

  protected shortDay(day: string): string {
    return formatDay(day, 'short');
  }
}
