import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { imageUrl } from '../api';
import type { Post } from '../shared/protocol';
import { Flower } from './flower';
import { handleColor } from './format';
import { LikeButton } from './like-button';
import { Plant } from './plant';

/** The day's most liked photo, shown next to the theme. */
@Component({
  selector: 'app-top-photo',
  imports: [RouterLink, LikeButton, Plant, Flower],
  template: `
    <figure class="pod">
      <p class="label"><app-flower /> Photo of the day</p>
      @if (post(); as post) {
        <button type="button" class="pic" (click)="open.emit()">
          <img [src]="thumb(post.id)" [alt]="'Photo of the day, by ' + post.handle" />
        </button>
        <figcaption class="foot">
          <a class="who" [routerLink]="['/u', post.handle]">
            <span class="avatar" [style.background]="color(post.handle)">{{ post.handle[0] }}</span>
            <span class="text">
              <b>{{ post.handle }}</b>
              <small>{{ isToday() ? 'Most liked so far' : 'Most liked that day' }}</small>
            </span>
          </a>
          <app-like-button
            [count]="post.likes"
            [liked]="post.liked"
            [disabled]="!canLike() || post.mine"
            (toggle)="like.emit(post)"
          />
        </figcaption>
      } @else {
        <div class="none">
          <app-plant [streak]="0" />
          <p>
            @if (isToday()) {
              Nothing has bloomed yet. Today's most liked photo ends up here.
            } @else {
              Nobody got a like that day.
            }
          </p>
        </div>
      }
    </figure>
  `,
  styles: `
    :host {
      display: block;
    }
    .pod {
      margin: 0;
      padding: 14px 14px 10px;
      border: 1px solid var(--line);
      border-radius: 20px;
      background: var(--surface);
      box-shadow: var(--shadow);
      transform: rotate(1.2deg);
    }
    .label {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 10px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .pic {
      display: block;
      width: 100%;
      aspect-ratio: 4 / 3;
      padding: 0;
      border: 0;
      border-radius: 14px;
      overflow: hidden;
      background: var(--leaf-soft);
      cursor: zoom-in;
    }
    .pic img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 0.4s ease;
    }
    .pic:hover img {
      transform: scale(1.04);
    }
    .foot {
      display: flex;
      align-items: center;
      gap: 6px;
      padding-top: 10px;
    }
    .who {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      min-width: 0;
      color: var(--ink);
      text-decoration: none;
    }
    .text {
      display: grid;
      min-width: 0;
      line-height: 1.25;
    }
    .text b,
    .text small {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .text small {
      color: var(--faint);
      font-size: 12px;
    }
    .none {
      display: grid;
      justify-items: center;
      gap: 10px;
      padding: 24px 14px 18px;
      border: 1.5px dashed var(--line);
      border-radius: 14px;
      color: var(--muted);
      font-size: 15px;
      text-align: center;
    }
    @media (max-width: 860px) {
      .pod {
        display: grid;
        grid-template-columns: 112px 1fr;
        column-gap: 14px;
        transform: none;
      }
      .label {
        grid-column: 2;
        align-self: end;
      }
      .pic {
        grid-column: 1;
        grid-row: 1 / span 2;
      }
      .foot {
        grid-column: 2;
        align-self: start;
        padding-top: 0;
      }
      .none {
        grid-column: 1 / -1;
        grid-template-columns: auto 1fr;
        justify-items: start;
        text-align: left;
        padding: 12px;
      }
    }
  `,
})
export class TopPhoto {
  readonly post = input<Post | null>(null);
  readonly isToday = input(false);
  readonly canLike = input(false);
  readonly open = output<void>();
  readonly like = output<Post>();

  protected thumb(id: string): string {
    return imageUrl(id, 'thumb');
  }

  protected color(handle: string): string {
    return handleColor(handle);
  }
}
