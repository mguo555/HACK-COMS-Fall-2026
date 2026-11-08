import {
  Component,
  ElementRef,
  Injectable,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';

/** Opens the "How it works" guide from anywhere (the header button, or after signing up). */
@Injectable({ providedIn: 'root' })
export class Guide {
  readonly open = signal(false);

  show(): void {
    this.open.set(true);
  }
}

/** The rules of the game, in a dialog. Lives in the app shell; Guide opens it. */
@Component({
  selector: 'app-how-it-works',
  template: `
    <dialog
      #dialog
      aria-labelledby="how-title"
      (close)="guide.open.set(false)"
      (click)="backdrop($event)"
    >
      <div class="inner">
        <div class="top">
          <h2 id="how-title">How it works</h2>
          <button type="button" class="x" aria-label="Close" (click)="close()">×</button>
        </div>
        <ol>
          <li>
            <b>One theme a day.</b> Everyone gets the same theme. A new one starts at midnight,
            Rochester time.
          </li>
          <li>
            <b>Post one photo for it.</b> Any time before midnight. Just the photo: no videos, no
            captions. Once it's up, that's your photo for the day, even if you delete it.
          </li>
          <li>
            <b>Like your favorites.</b> Tap the leaf under a photo. The most liked one becomes the
            photo of the day.
          </li>
          <li>
            <b>Grow your plant.</b> Post every day and the plant on your profile grows. Two weeks in
            a row and it flowers. Miss a day and it's back to a seed.
          </li>
          <li>
            <b>Keep it kind.</b> It's just for RIT students. If a photo looks wrong, report it and a
            mod will take a look.
          </li>
        </ol>
        <p class="fine">
          You sign in with your RIT email and a code we send you. It can land in spam or junk.
        </p>
        <button type="button" class="btn btn-primary" (click)="close()">Got it</button>
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      width: min(520px, calc(100vw - 32px));
      max-height: calc(100dvh - 32px);
      padding: 0;
      border: 1px solid var(--line);
      border-radius: 20px;
      background: var(--surface);
      color: var(--ink);
      box-shadow: var(--shadow);
    }
    dialog::backdrop {
      background: rgb(20 30 20 / 45%);
    }
    .inner {
      padding: 22px 24px 24px;
    }
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    h2 {
      font-size: 26px;
    }
    .x {
      width: 36px;
      height: 36px;
      border: 0;
      border-radius: 50%;
      background: var(--surface-2);
      font-size: 22px;
      line-height: 1;
      cursor: pointer;
    }
    ol {
      display: grid;
      gap: 14px;
      margin: 0 0 16px;
      padding: 0;
      list-style: none;
      counter-reset: step;
    }
    li {
      position: relative;
      padding-left: 40px;
      color: var(--muted);
      counter-increment: step;
    }
    li::before {
      content: counter(step);
      position: absolute;
      left: 0;
      top: 0;
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--leaf-soft);
      color: var(--leaf);
      font-weight: 700;
      font-size: 14px;
    }
    li b {
      color: var(--ink);
    }
    .fine {
      margin-bottom: 18px;
      padding: 10px 12px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--bloom) 22%, var(--surface));
      font-size: 14px;
    }
    .btn {
      width: 100%;
    }
  `,
})
export class HowItWorks {
  protected readonly guide = inject(Guide);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const el = this.dialog().nativeElement;
      if (this.guide.open() && !el.open) el.showModal();
      if (!this.guide.open() && el.open) el.close();
    });
  }

  protected close(): void {
    this.guide.open.set(false);
  }

  /** A click on the dimmed area outside the box closes it. */
  protected backdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.close();
  }
}
