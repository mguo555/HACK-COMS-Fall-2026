import { Component } from '@angular/core';

/** The sprout mark. */
@Component({
  selector: 'app-logo',
  template: `
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" class="bg" />
      <path d="M16 27V14" class="stem" />
      <path d="M16 17C16 11 12.5 7.5 6 7.5c0 6.5 3.5 10 10 9.5z" class="leaf-a" />
      <path d="M16 14c0-5 3-8 9-8 0 5.5-3 8.5-9 8z" class="leaf-b" />
    </svg>
  `,
  styles: `
    :host {
      display: block;
      width: 32px;
      height: 32px;
      flex: none;
    }
    .bg {
      fill: var(--tag);
    }
    .stem {
      stroke: var(--tag-ink);
      stroke-width: 2.6;
      stroke-linecap: round;
    }
    .leaf-a {
      fill: #9fd47f;
    }
    .leaf-b {
      fill: #cfeab8;
    }
  `,
})
export class Logo {}
