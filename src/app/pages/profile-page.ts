import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { ApiError, api, errorMessage } from '../api';
import { Likes, Notice, Session } from '../session';
import type { Post, Profile, ProfilePost } from '../shared/protocol';
import { Lightbox } from '../ui/lightbox';
import { Plant } from '../ui/plant';
import { PostGrid } from '../ui/post-grid';

/** Someone's garden: their streak plant, stats, and every photo they've posted. */
@Component({
  selector: 'app-profile-page',
  imports: [RouterLink, Plant, PostGrid, Lightbox],
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

  protected readonly joined = computed(() => {
    const p = this.profile();
    if (!p) return '';
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(p.joinedAt);
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
  }

  private async load(handle: string): Promise<void> {
    this.openIndex.set(null);
    this.confirmBan.set(false);
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
