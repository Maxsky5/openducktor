/**
 * The colors of the desktop code and diff views. Desktop draws code with `@pierre/diffs` and the
 * `pierre-light` and `pierre-dark` themes of `@pierre/theme`, on a white or near-black page. The
 * line washes, gutters, separators, and emphasis follow the `@pierre/diffs` stylesheet mixes.
 */
import type { HighlightTone } from "@/rich-content/code/highlight";

type Scheme = "light" | "dark";

type PierreTheme = {
  background: string;
  foreground: string;
  addition: string;
  deletion: string;
  selection: string;
  mixer: string;
  lineMix: number;
  gutterMix: number;
  separatorMix: number;
  numberMix: number;
  emphasisAlpha: string;
  syntax: Record<HighlightTone, string>;
};

/** The theme values that `@pierre/diffs` and `@pierre/theme` define. */
const PIERRE = {
  light: {
    background: "#ffffff",
    foreground: "#0a0a0a",
    addition: "#0dbe4e",
    deletion: "#ff2e3f",
    selection: "#009fff",
    mixer: "#000000",
    /** The share of the page color in a changed line, its gutter, and a separator. */
    lineMix: 0.88,
    gutterMix: 0.91,
    separatorMix: 0.96,
    numberMix: 0.65,
    /** The alpha of the changed word wash: 0.15. */
    emphasisAlpha: "26",
    syntax: {
      plain: "#0a0a0a",
      comment: "#737373",
      keyword: "#d32a61",
      string: "#199f43",
      number: "#1ca1c7",
      function: "#693acf",
      type: "#a631be",
      tag: "#d5512f",
      attribute: "#d47628",
      punctuation: "#636363",
      variable: "#d47628",
      inserted: "#18a46c",
      deleted: "#d52c36",
    },
  },
  dark: {
    background: "#0a0a0a",
    foreground: "#fafafa",
    addition: "#5ecc71",
    deletion: "#ff6762",
    selection: "#69b1ff",
    mixer: "#ffffff",
    lineMix: 0.8,
    gutterMix: 0.85,
    separatorMix: 0.85,
    numberMix: 0.65,
    /** The alpha of the changed word wash: 0.2. */
    emphasisAlpha: "33",
    syntax: {
      plain: "#fafafa",
      comment: "#737373",
      keyword: "#ff678d",
      string: "#5ecc71",
      number: "#68cdf2",
      function: "#9d6afb",
      type: "#d568ea",
      tag: "#ff855e",
      attribute: "#ffa359",
      // Lighter than the light theme value, so punctuation keeps a 4:1 contrast on added rows.
      punctuation: "#8c8c8c",
      variable: "#ffa359",
      inserted: "#07c480",
      deleted: "#ff2e3f",
    },
  },
} as const satisfies Record<Scheme, PierreTheme>;

/** Mixes two `#rrggbb` colors. `share` is the part of `base`. */
const mix = (base: string, target: string, share: number): string => {
  const channel = (hex: string, index: number): number =>
    Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  const parts = [0, 1, 2].map((index) =>
    Math.round(channel(base, index) * share + channel(target, index) * (1 - share))
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${parts.join("")}`;
};

export type PierreColors = {
  /** The page of a code or diff view. */
  background: string;
  foreground: string;
  lineNumber: string;
  /** The "N unmodified lines" bar between hunks. */
  separator: string;
  addition: string;
  deletion: string;
  additionLine: string;
  deletionLine: string;
  additionGutter: string;
  deletionGutter: string;
  /** The wash of the changed words in a changed line. */
  additionEmphasis: string;
  deletionEmphasis: string;
  /** A line in the comment selection. */
  selectionLine: string;
  selectionGutter: string;
  selectionNumber: string;
  syntax: Record<HighlightTone, string>;
};

const buildColors = (scheme: Scheme): PierreColors => {
  const pierre = PIERRE[scheme];
  const page = pierre.background;
  return {
    background: page,
    foreground: pierre.foreground,
    lineNumber: mix(pierre.foreground, page, pierre.numberMix),
    separator: mix(page, pierre.mixer, pierre.separatorMix),
    addition: pierre.addition,
    deletion: pierre.deletion,
    additionLine: mix(page, pierre.addition, pierre.lineMix),
    deletionLine: mix(page, pierre.deletion, pierre.lineMix),
    additionGutter: mix(page, pierre.addition, pierre.gutterMix),
    deletionGutter: mix(page, pierre.deletion, pierre.gutterMix),
    additionEmphasis: `${pierre.addition}${pierre.emphasisAlpha}`,
    deletionEmphasis: `${pierre.deletion}${pierre.emphasisAlpha}`,
    selectionLine: mix(page, pierre.selection, pierre.lineMix),
    selectionGutter: mix(page, pierre.selection, pierre.gutterMix - 0.16),
    selectionNumber: mix(pierre.selection, pierre.mixer, scheme === "light" ? 0.65 : 0.75),
    syntax: pierre.syntax,
  };
};

/** The desktop code colors of each color scheme. Read them with `PIERRE_COLORS[theme.scheme]`. */
export const PIERRE_COLORS = {
  light: buildColors("light"),
  dark: buildColors("dark"),
} as const satisfies Record<Scheme, PierreColors>;

/** The desktop code view metrics: IBM Plex Mono at 12 points on 18-point lines. */
export const CODE_FONT_SIZE = 12;
export const CODE_LINE_HEIGHT = 18;
/** IBM Plex Mono glyphs are 0.6 of the font size wide. */
const MONO_ADVANCE = 0.6;

/** The width of one code character at a system text scale. */
export const codeCharWidth = (fontScale: number): number =>
  MONO_ADVANCE * CODE_FONT_SIZE * fontScale;
