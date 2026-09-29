// The duck of the OpenDucktor mark, in a 64 unit box. The brand mark and the duck parade draw it.

/** The body of the duck, from the tail to the chest. */
export const BODY =
  "M3.5 23.5C8.5 29 15 32.5 24 32.5H42C53 32.5 59.5 39 59.5 45.5C59.5 51.5 53.5 56 45 56H19.5C11 56 5.5 50.5 5 42.5C4.6 36 3.2 29.5 3.5 23.5Z";
/** The head of the lead duck. The visor covers its eyes. */
export const HEAD = { cx: 37.5, cy: 20.5, r: 12.5 } as const;
/** The head of a duckling, with a square eye. */
export const DUCKLING_HEAD =
  "M37.5 8a12.5 12.5 0 1 1 0 25a12.5 12.5 0 1 1 0-25ZM38.25 15.75h4.5v4.5h-4.5z";
export const BILL = "M47.5 18.25H56.25A3.9 3.9 0 0 1 56.25 26.05H46.5Z";
/** The night vision visor, and the light that scans it. */
export const VISOR = "M29.8 17.8H46.2";
export const VISOR_LIGHT = "M40.2 17.8H43.4";
