import Anser from "anser";

/** The eight base colors of a terminal. Each client paints them with its theme colors. */
export const TERMINAL_TONES = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
] as const;
export type TerminalTone = (typeof TERMINAL_TONES)[number];

export type TerminalColor =
  | { kind: "tone"; tone: TerminalTone; bright: boolean }
  /** A 256-color or true color code, as `r, g, b`. */
  | { kind: "rgb"; rgb: string };

/**
 * The colors of the base tones on the dark surface of the integrated terminal, normal then bright.
 * Desktop and mobile paint command output with them in both themes.
 */
export const TERMINAL_TONE_COLORS = {
  black: ["#64748b", "#94a3b8"],
  red: ["#f87171", "#fca5a5"],
  green: ["#34d399", "#6ee7b7"],
  yellow: ["#fcd34d", "#fde68a"],
  blue: ["#38bdf8", "#7dd3fc"],
  magenta: ["#e879f9", "#f0abfc"],
  cyan: ["#22d3ee", "#67e8f9"],
  white: ["#e2e8f0", "#ffffff"],
} as const satisfies Record<TerminalTone, readonly [string, string]>;

/** The CSS color of a terminal color on the dark surface of the integrated terminal. */
export const terminalColorValue = (color: TerminalColor): string =>
  color.kind === "rgb"
    ? `rgb(${color.rgb})`
    : TERMINAL_TONE_COLORS[color.tone][color.bright ? 1 : 0];

// A unified diff, as `git diff` and `git show` print it without colors.
const UNIFIED_DIFF = /^(?:diff --git |@@ -\d+(?:,\d+)? \+\d+)/m;

/** Whether an output is a unified diff without colors, so a view can color its lines. */
export const isPlainUnifiedDiff = (text: string): boolean =>
  !text.includes(ESCAPE) && UNIFIED_DIFF.test(text);

/** The tone of a line of a unified diff: added, removed, a hunk, or a file header. */
export const readDiffLineTone = (line: string): TerminalTone | null => {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff --git")) {
    return "white";
  }
  if (line.startsWith("+")) return "green";
  if (line.startsWith("-")) return "red";
  if (line.startsWith("@@")) return "cyan";
  return null;
};

/** A run of command output with one style. */
export type TerminalTextSegment = {
  text: string;
  fg: TerminalColor | null;
  bg: TerminalColor | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
};

const ESCAPE = "\u001b";
// Each SGR, cursor, or erase sequence. The output keeps only the SGR colors and styles.
// oxlint-disable-next-line no-control-regex -- terminal escape sequences start with ESC.
const ESCAPE_SEQUENCES = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/**
 * A line that a command wrote again with carriage returns, such as a progress bar, keeps only its
 * last state, as a terminal shows it.
 */
const applyCarriageReturns = (text: string): string => {
  if (!text.includes("\r")) return text;
  return text
    .split("\n")
    .map((line) => {
      const content = line.endsWith("\r") ? line.slice(0, -1) : line;
      const last = content.lastIndexOf("\r");
      return last < 0 ? content : content.slice(last + 1);
    })
    .join("\n");
};

/** The text of a command output as a terminal shows it, without its escape sequences. */
export const readTerminalText = (text: string): string =>
  applyCarriageReturns(text.includes(ESCAPE) ? text.replace(ESCAPE_SEQUENCES, "") : text);

const PALETTE_LEVELS = [0, 95, 135, 175, 215, 255];

/** The `r, g, b` of an xterm 256-color index from 16 to 255. */
const paletteRgb = (index: number): string => {
  if (index >= 232) {
    const level = 8 + (index - 232) * 10;
    return `${level}, ${level}, ${level}`;
  }
  const cube = index - 16;
  const red = PALETTE_LEVELS[Math.floor(cube / 36)] ?? 0;
  const green = PALETTE_LEVELS[Math.floor(cube / 6) % 6] ?? 0;
  const blue = PALETTE_LEVELS[cube % 6] ?? 0;
  return `${red}, ${green}, ${blue}`;
};

const isTerminalTone = (value: string): value is TerminalTone =>
  TERMINAL_TONES.some((tone) => tone === value);

/** Reads the color class of anser: `ansi-red`, `ansi-bright-red`, `ansi-palette-n`, or true color. */
const readColor = (className: string | null, truecolor: string | null): TerminalColor | null => {
  if (!className) return null;
  if (className === "ansi-truecolor") return truecolor ? { kind: "rgb", rgb: truecolor } : null;
  if (className.startsWith("ansi-palette-")) {
    const index = Number(className.slice("ansi-palette-".length));
    return Number.isInteger(index) && index >= 16 && index <= 255
      ? { kind: "rgb", rgb: paletteRgb(index) }
      : null;
  }
  const bright = className.startsWith("ansi-bright-");
  const tone = className.slice(bright ? "ansi-bright-".length : "ansi-".length);
  return isTerminalTone(tone) ? { kind: "tone", tone, bright } : null;
};

const plainSegment = (text: string): TerminalTextSegment => ({
  text,
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  strikethrough: false,
});

/**
 * The styled runs of a command output. Most outputs have no escape sequence and give one plain
 * run. Escape sequences other than colors and styles do not show.
 */
export const parseTerminalText = (text: string): TerminalTextSegment[] => {
  if (!text.includes(ESCAPE)) return text ? [plainSegment(applyCarriageReturns(text))] : [];
  const entries = Anser.ansiToJson(applyCarriageReturns(text), {
    use_classes: true,
    remove_empty: true,
  });
  return entries.map((entry) => ({
    text: entry.content.replace(ESCAPE_SEQUENCES, ""),
    fg: readColor(entry.fg, entry.fg_truecolor),
    bg: readColor(entry.bg, entry.bg_truecolor),
    bold: entry.decoration === "bold",
    dim: entry.decoration === "dim",
    italic: entry.decoration === "italic",
    underline: entry.decoration === "underline",
    strikethrough: entry.decoration === "strikethrough",
  }));
};

/**
 * The lines of a command output, each as its styled runs. A view can then indent the wrapped part
 * of a long line. A last line break does not start a line.
 */
export const parseTerminalLines = (text: string): TerminalTextSegment[][] => {
  const lines: TerminalTextSegment[][] = [[]];
  for (const segment of parseTerminalText(text)) {
    const parts = segment.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines[lines.length - 1]?.push({ ...segment, text: part });
    });
  }
  if (lines.length > 1 && lines[lines.length - 1]?.length === 0) lines.pop();
  return text ? lines : [];
};
