import { Component, DestroyRef, effect, inject, untracked } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Notice, Session } from './session';
import { Guide, HowItWorks } from './ui/how-it-works';
import { Logo } from './ui/logo';
import { Vines } from './ui/vines';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Logo, Vines, HowItWorks],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly session = inject(Session);
  protected readonly notice = inject(Notice);
  protected readonly guide = inject(Guide);
  private readonly router = inject(Router);

  constructor() {
    this.session.refresh();

    // New accounts pick a name before anything else.
    effect(() => {
      const user = this.session.user();
      if (user && !user.handle) {
        untracked(() => {
          if (!this.router.url.startsWith('/sign-in')) this.router.navigate(['/sign-in']);
        });
      }
    });

    // At midnight (Rochester time) the day and theme change. Pick that up without a reload.
    const timer = setInterval(() => {
      const next = this.session.nextDayAt();
      if (next && Date.now() >= next) this.session.refresh();
    }, 15_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
