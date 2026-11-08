import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { ApiError, api, errorMessage } from '../api';
import { Likes, Notice, Session } from '../session';
import { DEFAULT_TIME_ZONE, dayKey } from '../shared/days';
import { HANDLE_MAX, handleProblem, normalizeHandle } from '../shared/rules';
import type { Post, Profile, ProfilePost } from '../shared/protocol';
import { Lightbox } from '../ui/lightbox';
import { Plant } from '../ui/plant';
import { PostCalendar } from '../ui/post-calendar';
import { PostGrid } from '../ui/post-grid';

/** Someone's garden: their streak plant, stats, and every photo they've posted. */
@Component({
  selector: 'app-profile-page',
  imports: [RouterLink, Plant, PostGrid, Lightbox, PostCalendar],
  templateUrl: './profile-page.html',
  styleUrl: './profile-page.css',
})
export class ProfilePage {
  readonly handle = input.required<string>();

  protected readonly session = inject(Session);
  private readonly likes = inject(Likes);
  private readonly notice = inject(Notice);
  private readonly router = inject(Router);
  private readonly title = inject(Title);

  protected readonly profile = signal<Profile | null>(null);
  protected readonly posts = signal<ProfilePost[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly signedOut = signal(false);
  protected readonly openIndex = signal<number | null>(null);
  protected readonly confirmBan = signal(false);

  // Changing your name (only on your own profile).
  protected readonly renaming = signal(false);
  protected readonly newName = signal('');
  protected readonly nameError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly handleMax = HANDLE_MAX;
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  protected readonly joined = computed(() => {
    const p = this.profile();
    if (!p) return '';
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(p.joinedAt);
  });

  protected readonly joinedDay = computed(() => {
    const p = this.profile();
    return p ? dayKey(p.joinedAt, DEFAULT_TIME_ZONE) : '';
  });

  protected readonly streakNote = computed(() => {
    const p = this.profile();
    if (!p?.isMe) return '';
    if (!p.streak)
      return 'Post today to plant a seed. Your plant grows every day you post in a row.';
    if (p.streak < 14)
      return 'Your plant grows every day you post in a row. Two weeks gets it to flower.';
    return 'In full bloom. Miss a day and it starts over from a seed.';
  });

  constructor() {
    effect(() => {
      const handle = this.handle();
      this.session.user();
      untracked(() => this.load(handle));
    });
    // Select the current name as soon as the box opens, so typing replaces it.
    effect(() => this.nameInput()?.nativeElement.select());
  }

  private async load(handle: string): Promise<void> {
    this.openIndex.set(null);
    this.confirmBan.set(false);
    this.renaming.set(false);
    try {
      const profile = await api.profile(handle);
      this.profile.set(profile);
      this.posts.set(profile.posts);
      this.error.set(null);
      this.title.setTitle(`${profile.handle} · TheDailyStalk`);
    } catch (error) {
      this.profile.set(null);
      if (error instanceof ApiError && error.status === 401) this.signedOut.set(true);
      else this.error.set(errorMessage(error));
    }
  }

  protected like(post: Post): void {
    this.likes.toggle(this.posts, post);
  }

  protected removed(post: Post): void {
    this.openIndex.set(null);
    this.posts.update((posts) => posts.filter((p) => p.id !== post.id));
    // Only you can delete from your own profile, so the day turns into a "deleted" day.
    this.profile.update(
      (p) =>
        p && {
          ...p,
          calendar: p.calendar.map((d) =>
            d.id === post.id ? { ...d, status: 'deleted' as const, id: null } : d,
          ),
        },
    );
  }

  protected openById(id: string): void {
    const index = this.posts().findIndex((p) => p.id === id);
    if (index >= 0) this.openIndex.set(index);
  }

  protected startRename(current: string): void {
    this.newName.set(current);
    this.nameError.set(null);
    this.renaming.set(true);
  }

  protected async saveName(): Promise<void> {
    const handle = normalizeHandle(this.newName());
    const problem = handleProblem(handle);
    if (problem) {
      this.nameError.set(problem);
      return;
    }
    this.saving.set(true);
    try {
      const { user } = await api.setHandle(handle);
      // Move to the new address first, so the old one never gets loaded again.
      await this.router.navigate(['/u', user.handle], { replaceUrl: true });
      this.session.setUser(user);
      this.notice.show(`You're ${user.handle} now.`);
    } catch (error) {
      this.nameError.set(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected async signOut(): Promise<void> {
    try {
      await api.signOut();
    } finally {
      this.session.setUser(null);
      this.router.navigate(['/']);
    }
  }

  protected async ban(handle: string): Promise<void> {
    try {
      await api.ban(handle);
      this.notice.show(`${handle} is banned and their photos are down.`);
      this.router.navigate(['/mod']);
    } catch (error) {
      this.notice.show(errorMessage(error));
    }
  }
}
