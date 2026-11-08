import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found-page',
  imports: [RouterLink],
  template: `
    <div class="empty gap">
      <h1>Nothing growing here</h1>
      <p>That page doesn't exist.</p>
      <p><a routerLink="/">Back to today</a></p>
    </div>
  `,
  styles: `
    .gap {
      display: grid;
      gap: 8px;
      margin-top: 40px;
    }
    h1 {
      font-size: 28px;
      color: var(--ink);
    }
  `,
})
export class NotFoundPage {}
