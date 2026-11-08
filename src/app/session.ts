import { Injectable, WritableSignal, computed, inject, signal } from '@angular/core';
import { api, errorMessage } from './api';
import type { Me, Post, SessionInfo } from './shared/protocol';

/** Who is signed in, and today's date and theme. Loaded once at startup, then kept fresh. */
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly info = signal<SessionInfo | null>(null);

  readonly user = computed(() => this.info()?.user ?? null);
  readonly today = computed(() => this.info()?.today ?? null);
  readonly nextDayAt = computed(() => this.info()?.nextDayAt ?? 0);
  readonly loaded = computed(() => this.info() !== null);
  /** Signed-out visitors can look around only when the server isn't members-only. */
  readonly canView = computed(() => !!this.user() || this.info()?.membersOnly === false);
  /** Liking, reporting and posting need an account with a name. */
  readonly canAct = computed(() => !!this.user()?.handle);
  readonly error = signal<string | null>(null);

  async refresh(): Promise<void> {
    try {
      this.info.set(await api.session());
      this.error.set(null);
    } catch (error) {
      this.error.set(errorMessage(error));
    }
  }

  setUser(user: Me | null): void {
    this.info.update((info) => (info ? { ...info, user } : info));
  }
}

/** A short message at the bottom of the screen. */
@Injectable({ providedIn: 'root' })
export class Notice {
  readonly message = signal<string | null>(null);
  private timer?: ReturnType<typeof setTimeout>;

  show(message: string): void {
    this.message.set(message);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.message.set(null), 4000);
  }
}

/** Likes or unlikes a post in a list right away, then confirms with the server. */
@Injectable({ providedIn: 'root' })
export class Likes {
  private readonly notice = inject(Notice);

  async toggle<T extends Post>(list: WritableSignal<T[]>, post: Post): Promise<void> {
    const set = (likes: number, liked: boolean) =>
      list.update((posts) => posts.map((p) => (p.id === post.id ? { ...p, likes, liked } : p)));
    const liked = !post.liked;
    set(post.likes + (liked ? 1 : -1), liked);
    try {
      const result = await api.like(post.id, liked);
      set(result.likes, result.liked);
    } catch (error) {
      set(post.likes, post.liked);
      this.notice.show(errorMessage(error));
    }
  }
}
