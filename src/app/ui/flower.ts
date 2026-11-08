import { Component } from '@angular/core';

/** A five-petal flower, used to mark the photo of the day. */
@Component({
  selector: 'app-flower',
  template: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g class="petals">
        <circle cx="12" cy="6" r="4" />
        <circle cx="17.7" cy="10.1" r="4" />
        <circle cx="15.5" cy="16.9" r="4" />
        <circle cx="8.5" cy="16.9" r="4" />
        <circle cx="6.3" cy="10.1" r="4" />
      </g>
      <circle class="eye" cx="12" cy="12" r="3.2" />
    </svg>
  `,
  styles: `
    :host {
      display: inline-block;
      width: 18px;
      height: 18px;
      flex: none;
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
    }
    .petals {
      fill: var(--petal);
    }
    .eye {
      fill: var(--bloom);
    }
  `,
})
export class Flower {}
