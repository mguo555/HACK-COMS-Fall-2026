import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { api, errorMessage, imageUrl } from '../api';
import { Notice, Session } from '../session';
import { formatDay } from '../shared/days';
import { LikeButton } from './like-button';
import type { GridPost } from './post-grid';

type Confirming = 'delete' | 'report' | 'remove' | null;

/** One photo, big. Arrow keys or the side buttons move through the list; Esc closes. */
@Component({
  selector: 'app-lightbox',
  imports: [RouterLink, LikeButton],
  templateUrl: './lightbox.html',
  styleUrl: './lightbox.css',
})
export class Lightbox {
  readonly posts = input.required<GridPost[]>();
  readonly index = input.required<number>();
  readonly go = output<number>();
  readonly closed = output<void>();
  readonly like = output<GridPost>();
  /** The photo was deleted by its owner or taken down by a mod. */
  readonly removed = output<GridPost>();

  protected readonly session = inject(Session);
  private readonly notice = inject(Notice);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly post = computed(() => this.posts()[this.index()] ?? null);
  protected readonly hasPrev = computed(() => this.index() > 0);
  protected readonly hasNext = computed(() => this.index() < this.posts().length - 1);
  protected readonly confirming = signal<Confirming>(null);
  protected readonly busy = signal(false);

  constructor() {
    afterNextRender(() => this.dialog().nativeElement.showModal());
    // Moving to another photo cancels any "are you sure?" question.
    effect(() => {
      this.index();
      this.confirming.set(null);
    });
  }

  protected full(id: string): string {
    return imageUrl(id, 'full');
  }

  protected day(date: string): string {
    return formatDay(date);
  }

  protected step(by: number): void {
    const next = this.index() + by;
    if (next >= 0 && next < this.posts().length) this.go.emit(next);
  }

  protected key(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') this.step(-1);
    if (event.key === 'ArrowRight') this.step(1);
  }

  /** Clicks on the dark backdrop (not the photo or the buttons) close the dialog. */
  protected backdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close();
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  protected async confirm(post: GridPost): Promise<void> {
    const action = this.confirming();
    if (!action) return;
    this.busy.set(true);
    try {
      if (action === 'report') {
        await api.report(post.id);
        this.notice.show('Thanks. A mod will take a look.');
      } else {
        await (action === 'delete' ? api.deletePost(post.id) : api.moderate(post.id, 'remove'));
        this.notice.show(action === 'delete' ? 'Your photo is gone.' : 'Photo taken down.');
        this.removed.emit(post);
      }
      this.confirming.set(null);
    } catch (error) {
      this.notice.show(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
