import { Component } from '@angular/core';

interface Leaf {
  x: number;
  y: number;
  turn: number;
  size: number;
  alt?: boolean;
}

// One tile of vine, 380 tall (and wide enough that it never repeats sideways in a strip). The stem leaves the bottom at the same spot and angle
// it enters the top, so tiles repeat down the page without a seam.
const STEM = 'M30 0C60 50 60 140 30 190C0 240 0 330 30 380';
const LEAF = 'M0 0C6-10 22-12 30-4C22 4 8 6 0 0z';
const LEAVES: Leaf[] = [
  { x: 47, y: 52, turn: -25, size: 1 },
  { x: 53, y: 108, turn: 20, size: 0.8, alt: true },
  { x: 47, y: 152, turn: 150, size: 0.7 },
  { x: 14, y: 228, turn: -35, size: 0.95, alt: true },
  { x: 8, y: 285, turn: 25, size: 1.1 },
  { x: 16, y: 342, turn: -10, size: 0.75, alt: true },
];
const CURLS = ['M53 108c9-4 15 4 9 9c-5 4-10-1-6-4', 'M10 260c-8-1-10 8-4 10c5 1 6-4 2-5'];

/**
 * Decorative vines climbing down both sides of wide screens, in the empty space next to the
 * content. Hidden on narrower screens, where there's no empty space to fill.
 */
@Component({
  selector: 'app-vines',
  template: `
    @for (side of sides; track side.name) {
      <div class="strip" [class]="side.name" aria-hidden="true">
        <svg width="100%" height="100%">
          <defs>
            @for (strand of strands; track strand.name) {
              <pattern
                [attr.id]="'vine-' + side.name + '-' + strand.name"
                width="400"
                height="380"
                patternUnits="userSpaceOnUse"
                [attr.patternTransform]="strand.move + ' translate(0 ' + side.shift + ')'"
              >
                <path class="stem" [attr.d]="stem" />
                @for (curl of curls; track $index) {
                  <path class="curl" [attr.d]="curl" />
                }
                @for (leaf of leaves; track $index) {
                  <path
                    class="leaf"
                    [class.alt]="leaf.alt"
                    [attr.d]="leafPath"
                    [attr.transform]="
                      'translate(' +
                      leaf.x +
                      ' ' +
                      leaf.y +
                      ') rotate(' +
                      leaf.turn +
                      ') scale(' +
                      leaf.size +
                      ')'
                    "
                  />
                }
                <g class="bud" transform="translate(56 250)">
                  <circle cy="-4" r="3.4" />
                  <circle cx="3.8" cy="-1.2" r="3.4" />
                  <circle cx="2.4" cy="3.2" r="3.4" />
                  <circle cx="-2.4" cy="3.2" r="3.4" />
                  <circle cx="-3.8" cy="-1.2" r="3.4" />
                  <circle class="eye" r="2.4" />
                </g>
              </pattern>
            }
          </defs>
          @for (strand of strands; track strand.name) {
            <rect
              width="100%"
              height="100%"
              [class]="strand.name"
              [attr.fill]="'url(#vine-' + side.name + '-' + strand.name + ')'"
            />
          }
        </svg>
      </div>
    }
  `,
  styles: `
    :host {
      position: absolute;
      top: 60px;
      right: 0;
      bottom: 0;
      left: 0;
      z-index: -1;
      overflow: hidden;
      pointer-events: none;
    }
    .strip {
      position: absolute;
      top: 0;
      bottom: 0;
      width: min(240px, calc((100% - 1100px) / 2));
    }
    .left {
      left: 0;
    }
    .right {
      right: 0;
      transform: scaleX(-1);
    }
    svg {
      display: block;
    }
    .stem,
    .curl {
      fill: none;
      stroke: var(--vine);
      stroke-linecap: round;
    }
    .stem {
      stroke-width: 3;
    }
    .curl {
      stroke-width: 1.6;
    }
    .leaf {
      fill: var(--vine-leaf);
    }
    .leaf.alt {
      fill: var(--vine-leaf-2);
    }
    .bud circle {
      fill: var(--petal);
    }
    .bud .eye {
      fill: var(--bloom);
    }
    .far {
      opacity: 0.5;
    }
    @media (max-width: 1220px) {
      :host {
        display: none;
      }
    }
  `,
})
export class Vines {
  protected readonly stem = STEM;
  protected readonly leafPath = LEAF;
  protected readonly leaves = LEAVES;
  protected readonly curls = CURLS;
  // The right side starts half a tile lower so the two sides don't mirror each other exactly.
  protected readonly sides = [
    { name: 'left', shift: 0 },
    { name: 'right', shift: 190 },
  ];
  // A second, smaller and fainter vine further in fills wide screens.
  protected readonly strands = [
    { name: 'near', move: '' },
    { name: 'far', move: 'translate(120 140) scale(0.75)' },
  ];
}
