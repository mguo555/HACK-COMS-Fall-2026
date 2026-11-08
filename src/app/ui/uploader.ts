import { Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { api, errorMessage, imageUrl } from '../api';
import type { MyPost } from '../shared/protocol';

const MAX_MB = 15;

/** Today's slot: pick a photo, check it, post it. Or, once posted, how today went. */
@Component({
  selector: 'app-uploader',
  templateUrl: './uploader.html',
  styleUrl: './uploader.css',
})
export class Uploader {
  readonly mine = input<MyPost | null>(null);
  readonly day = input.required<string>();
  readonly posted = output<MyPost>();
  readonly openMine = output<void>();

  protected readonly file = signal<File | null>(null);
  protected readonly preview = signal<string | null>(null);
  protected readonly previewFailed = signal(false);
  protected readonly busy = signal(false);
  protected readonly dragging = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clear());
  }

  protected thumb(id: string): string {
    return imageUrl(id, 'thumb');
  }

  protected picked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) this.choose(file);
  }

  protected dropped(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) this.choose(file);
  }

  protected dragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  private choose(file: File): void {
    this.error.set(null);
    if (file.type.startsWith('video/')) {
      this.error.set('Videos aren’t allowed. Still photos only.');
      return;
    }
    if (file.type && !file.type.startsWith('image/')) {
      this.error.set('That isn’t a photo.');
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      this.error.set(`That photo is too big. The limit is ${MAX_MB} MB.`);
      return;
    }
    this.clear();
    this.file.set(file);
    this.preview.set(URL.createObjectURL(file));
  }

  protected clear(): void {
    const url = this.preview();
    if (url) URL.revokeObjectURL(url);
    this.preview.set(null);
    this.previewFailed.set(false);
    this.file.set(null);
  }

  protected async post(): Promise<void> {
    const file = this.file();
    if (!file || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const { post } = await api.upload(file, this.day());
      this.clear();
      this.posted.emit(post);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
