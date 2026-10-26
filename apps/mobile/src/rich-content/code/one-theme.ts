/**
 * The Prism One Light and One Dark themes of the desktop `markdown-syntax-block.tsx`, from
 * `react-syntax-highlighter/dist/esm/styles/prism/one-light` and `one-dark`. The highlighter
 * colors a token by its own class name, so only the plain class rules apply.
 */

/** The color groups of the One themes. `base` is the color of the code block text. */
export type OneTone = "base" | "comment" | "orange" | "purple" | "red" | "green" | "blue" | "cyan";

/** The One group of each Prism token class. Other classes keep the color of their parent. */
export const ONE_TOKEN_TONES: ReadonlyMap<string, OneTone> = new Map<string, OneTone>([
  ["comment", "comment"],
  ["prolog", "comment"],
  ["cdata", "comment"],
  ["doctype", "base"],
  ["punctuation", "base"],
  ["entity", "base"],
  ["attr-name", "orange"],
  ["class-name", "orange"],
  ["boolean", "orange"],
  ["constant", "orange"],
  ["number", "orange"],
  ["atrule", "orange"],
  ["keyword", "purple"],
  ["property", "red"],
  ["tag", "red"],
  ["symbol", "red"],
  ["deleted", "red"],
  ["important", "red"],
  ["selector", "green"],
  ["string", "green"],
  ["char", "green"],
  ["builtin", "green"],
  ["inserted", "green"],
  ["regex", "green"],
  ["attr-value", "green"],
  ["variable", "blue"],
  ["operator", "blue"],
  ["function", "blue"],
  ["url", "cyan"],
]);

export const ONE_THEME_COLORS = {
  light: {
    base: "hsl(230, 8%, 24%)",
    comment: "hsl(230, 4%, 64%)",
    orange: "hsl(35, 99%, 36%)",
    purple: "hsl(301, 63%, 40%)",
    red: "hsl(5, 74%, 59%)",
    green: "hsl(119, 34%, 47%)",
    blue: "hsl(221, 87%, 60%)",
    cyan: "hsl(198, 99%, 37%)",
  },
  dark: {
    base: "hsl(220, 14%, 71%)",
    comment: "hsl(220, 10%, 40%)",
    orange: "hsl(29, 54%, 61%)",
    purple: "hsl(286, 60%, 67%)",
    red: "hsl(355, 65%, 65%)",
    green: "hsl(95, 38%, 62%)",
    blue: "hsl(207, 82%, 66%)",
    cyan: "hsl(187, 47%, 55%)",
  },
} as const satisfies Record<"light" | "dark", Record<OneTone, string>>;
