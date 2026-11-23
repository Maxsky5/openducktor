// The OpenDucktor mark of the film titles: the violet tile, the duck, its visor, and the light on
// the visor. The paths copy the mark of the app, and the titles rock the duck.
// `copied-film-mark.test.ts` compares the paths with the mark of the replicas.
import type { ReactElement } from "react";

/** The paths of the duck in its 64 unit box, from the mark of the app. */
const DUCK = {
  body: "M3.5 23.5C8.5 29 15 32.5 24 32.5H42C53 32.5 59.5 39 59.5 45.5C59.5 51.5 53.5 56 45 56H19.5C11 56 5.5 50.5 5 42.5C4.6 36 3.2 29.5 3.5 23.5Z",
  head: { cx: 37.5, cy: 20.5, r: 12.5 },
  bill: "M47.5 18.25H56.25A3.9 3.9 0 0 1 56.25 26.05H46.5Z",
  visor: "M29.8 17.8H46.2",
  light: "M40.2 17.8H43.4",
} as const;

export function Mark(): ReactElement {
  return (
    <svg className="film-mark" viewBox="0 0 64 64">
      <rect className="film-mark-tile" width="64" height="64" rx="15" />
      <g className="film-mark-duck" data-mark-duck="">
        <g transform="translate(8.5 8) scale(0.74)">
          <path d={DUCK.body} />
          <circle cx={DUCK.head.cx} cy={DUCK.head.cy} r={DUCK.head.r} />
          <path d={DUCK.bill} />
          <path className="film-mark-visor" d={DUCK.visor} />
          <path className="film-mark-light" d={DUCK.light} />
        </g>
      </g>
    </svg>
  );
}
