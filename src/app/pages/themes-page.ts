import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiError, api, errorMessage, imageUrl } from '../api';
import { Session } from '../session';
import { formatDay } from '../shared/days';
import type { ThemeList } from '../shared/protocol';

/** Today's theme, the week ahead, and every past day with its photos. */
@Component({
  selector: 'app-themes-page',
  imports: [RouterLink],
  templateUrl: './themes-page.html',
  styleUrl: './themes-page.css',
})
export class ThemesPage {
  protected readonly session = inject(Session);
  protected readonly list = signal<ThemeList | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly signedOut = signal(false);

  constructor() {
    this.load();
  }

  private async load(): Promise<void> {
    try {
      this.list.set(await api.themes());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) this.signedOut.set(true);
      else this.error.set(errorMessage(error));
    }
  }

  protected day(date: string, style: 'long' | 'short' = 'short'): string {
    return formatDay(date, style);
  }

  protected thumb(id: string): string {
    return imageUrl(id, 'thumb');
  }
}
