import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { api, errorMessage } from '../api';
import { Notice, Session } from '../session';
import { HANDLE_MAX, handleProblem, normalizeHandle } from '../shared/rules';
import { Guide } from '../ui/how-it-works';

type Step = 'email' | 'code' | 'handle';

/** Email, then the 6-digit code we send, then (first time only) a name. */
@Component({
  selector: 'app-sign-in-page',
  templateUrl: './sign-in-page.html',
  styleUrl: './sign-in-page.css',
})
export class SignInPage {
  private readonly session = inject(Session);
  private readonly notice = inject(Notice);
  private readonly router = inject(Router);
  private readonly guide = inject(Guide);

  protected readonly step = signal<Step>('email');
  protected readonly email = signal('');
  protected readonly code = signal('');
  protected readonly handle = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly handleMax = HANDLE_MAX;

  private readonly resendAt = signal(0);
  private readonly now = signal(Date.now());
  protected readonly resendIn = computed(() =>
    Math.max(0, Math.ceil((this.resendAt() - this.now()) / 1000)),
  );

  constructor() {
    effect(() => {
      const user = this.session.user();
      if (!user) return;
      untracked(() => {
        if (user.handle) this.router.navigate(['/']);
        else this.step.set('handle');
      });
    });
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected async sendCode(): Promise<void> {
    const email = this.email().trim();
    if (!email.includes('@')) {
      this.error.set('Enter your full RIT email, like abc1234@rit.edu.');
      return;
    }
    await this.run(async () => {
      const { resendIn } = await api.requestCode(email);
      this.now.set(Date.now());
      this.resendAt.set(Date.now() + resendIn * 1000);
      this.code.set('');
      this.step.set('code');
    });
  }

  protected typeCode(value: string): void {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    this.code.set(digits);
    if (digits.length === 6) this.verify();
  }

  protected async verify(): Promise<void> {
    if (this.code().length !== 6 || this.busy()) return;
    await this.run(async () => {
      await api.verify(this.email().trim(), this.code());
      // Make sure the browser actually kept the sign-in cookie before moving on. If it didn't
      // (cookies blocked, or an odd address), say so now instead of failing on the next step.
      const { user } = await api.session();
      if (!user) {
        throw new Error(
          'Your browser didn’t keep you signed in. Make sure cookies are allowed for this site, then try again.',
        );
      }
      this.session.setUser(user);
      if (user.handle) this.notice.show(`Welcome back, ${user.handle}.`);
    });
  }

  protected async saveHandle(): Promise<void> {
    const handle = normalizeHandle(this.handle());
    const problem = handleProblem(handle);
    if (problem) {
      this.error.set(problem);
      return;
    }
    await this.run(async () => {
      const firstTime = !this.session.user()?.handle;
      const { user } = await api.setHandle(handle);
      this.session.setUser(user);
      this.notice.show(`You're in, ${user.handle}.`);
      if (firstTime) this.guide.show();
    });
  }

  protected startOver(): void {
    this.step.set('email');
    this.code.set('');
    this.error.set(null);
  }

  private async run(task: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await task();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
