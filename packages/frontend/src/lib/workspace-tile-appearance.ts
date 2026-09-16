import type { CSSProperties } from "react";

export type WorkspaceTilePaletteEntry = {
  id: string;
  label: string;
  hex: string;
};

/**
 * Tailwind accent values, level 500 except for violet, which uses level 600 so that every entry
 * keeps a contrast ratio of at least 4.5 against the label color that `tileForegroundColor`
 * picks for it.
 */
export const WORKSPACE_TILE_PALETTE: readonly WorkspaceTilePaletteEntry[] = [
  { id: "red", label: "Red", hex: "#ef4444" },
  { id: "orange", label: "Orange", hex: "#f97316" },
  { id: "amber", label: "Amber", hex: "#f59e0b" },
  { id: "green", label: "Green", hex: "#22c55e" },
  { id: "emerald", label: "Emerald", hex: "#10b981" },
  { id: "teal", label: "Teal", hex: "#14b8a6" },
  { id: "sky", label: "Sky", hex: "#0ea5e9" },
  { id: "blue", label: "Blue", hex: "#3b82f6" },
  { id: "violet", label: "Violet", hex: "#7c3aed" },
  { id: "fuchsia", label: "Fuchsia", hex: "#d946ef" },
  { id: "rose", label: "Rose", hex: "#f43f5e" },
  { id: "slate", label: "Slate", hex: "#64748b" },
  { id: "white", label: "White", hex: "#ffffff" },
  { id: "black", label: "Black", hex: "#000000" },
];

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Counts what a reader sees rather than UTF-16 code units, so a decomposed accent stays one
 * character and a letter outside the basic plane is never cut in half.
 */
export const graphemesOf = (text: string): string[] =>
  [...GRAPHEME_SEGMENTER.segment(text)].map(({ segment }) => segment);

const firstGraphemes = (text: string, count: number): string =>
  graphemesOf(text).slice(0, count).join("");

export const deriveWorkspaceInitials = (workspaceName: string): string => {
  const trimmedName = workspaceName.trim();
  if (!trimmedName) {
    return "?";
  }

  // Split on anything that is not a letter, a digit or a combining mark, so `Équipe Mobile` keeps
  // its leading `É` whether the accent is precomposed or decomposed, and `_alpha` drops its
  // leading underscore. macOS reports directory names decomposed, and a workspace name often
  // starts life as a directory name.
  const segments = trimmedName
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .reduce<string[]>((nextSegments, segment) => {
      const trimmedSegment = segment.trim();
      if (trimmedSegment.length > 0) {
        nextSegments.push(trimmedSegment);
      }
      return nextSegments;
    }, []);

  if (segments.length >= 2) {
    return `${firstGraphemes(segments[0] ?? "", 1)}${firstGraphemes(segments[1] ?? "", 1)}`.toUpperCase();
  }

  return firstGraphemes(segments[0] ?? trimmedName, 2).toUpperCase();
};

/**
 * Accepts a 6-digit RGB hex value with an optional leading `#` in any letter case. Every other
 * input is rejected, so a typo never resolves to a nearest or default color.
 */
export const normalizeHexInput = (raw: string): string | null => {
  const candidate = raw.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(candidate)) {
    return null;
  }
  return `#${candidate.toLowerCase()}`;
};

type RgbChannels = { red: number; green: number; blue: number };

const hexToRgb = (hex: string): RgbChannels => ({
  red: Number.parseInt(hex.slice(1, 3), 16),
  green: Number.parseInt(hex.slice(3, 5), 16),
  blue: Number.parseInt(hex.slice(5, 7), 16),
});

const rgbToHex = ({ red, green, blue }: RgbChannels): string => {
  const channel = (value: number): string =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
};

type Hsl = { hue: number; saturation: number; lightness: number };

const rgbToHsl = ({ red, green, blue }: RgbChannels): Hsl => {
  const normalizedRed = red / 255;
  const normalizedGreen = green / 255;
  const normalizedBlue = blue / 255;
  const max = Math.max(normalizedRed, normalizedGreen, normalizedBlue);
  const min = Math.min(normalizedRed, normalizedGreen, normalizedBlue);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) {
    return { hue: 0, saturation: 0, lightness };
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === normalizedRed) {
    hue = 60 * (((normalizedGreen - normalizedBlue) / delta) % 6);
  } else if (max === normalizedGreen) {
    hue = 60 * ((normalizedBlue - normalizedRed) / delta + 2);
  } else {
    hue = 60 * ((normalizedRed - normalizedGreen) / delta + 4);
  }

  return { hue: (hue + 360) % 360, saturation, lightness };
};

const sectorChannels = (sector: number, chroma: number, secondary: number): RgbChannels => {
  if (sector === 0) {
    return { red: chroma, green: secondary, blue: 0 };
  }
  if (sector === 1) {
    return { red: secondary, green: chroma, blue: 0 };
  }
  if (sector === 2) {
    return { red: 0, green: chroma, blue: secondary };
  }
  if (sector === 3) {
    return { red: 0, green: secondary, blue: chroma };
  }
  if (sector === 4) {
    return { red: secondary, green: 0, blue: chroma };
  }
  return { red: chroma, green: 0, blue: secondary };
};

const hslToRgb = ({ hue, saturation, lightness }: Hsl): RgbChannels => {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = lightness - chroma / 2;
  const channels = sectorChannels(Math.floor(hue / 60) % 6, chroma, secondary);
  return {
    red: (channels.red + match) * 255,
    green: (channels.green + match) * 255,
    blue: (channels.blue + match) * 255,
  };
};

export type WorkspaceTileShade = {
  level: number;
  lightnessPercent: number;
  hex: string;
};

const SHADE_LIGHTNESS_PERCENTS = [88, 72, 56, 40, 26];

/**
 * Keeps the hue and the saturation of the given color and returns five variants from the
 * lightest to the darkest.
 *
 * A color that already sits on one of the ramp lightness levels is placed at that level
 * unchanged. Without this the 8-bit rounding of a hex value shifts a shade by one unit per
 * round trip, and a shade the user just picked would no longer appear in its own row.
 */
export const tileShadeRamp = (hex: string): WorkspaceTileShade[] => {
  const { hue, saturation, lightness } = rgbToHsl(hexToRgb(hex));
  const ownLightnessPercent = Math.round(lightness * 100);
  return SHADE_LIGHTNESS_PERCENTS.map((lightnessPercent, index) => ({
    level: index + 1,
    lightnessPercent,
    hex:
      lightnessPercent === ownLightnessPercent
        ? hex
        : rgbToHex(hslToRgb({ hue, saturation, lightness: lightnessPercent / 100 })),
  }));
};

// Pure black and pure white are the candidates because one of the two always reaches at least a
// 4.5 contrast ratio against any opaque RGB color. A softer dark, such as slate 900, leaves a band
// of mid grays that clears neither candidate.
const LIGHT_TILE_FOREGROUND = "#ffffff";
const DARK_TILE_FOREGROUND = "#000000";

const relativeLuminance = (hex: string): number => {
  const { red, green, blue } = hexToRgb(hex);
  const channel = (value: number): number => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
};

const contrastRatio = (left: string, right: string): number => {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);
  return (lighter + 0.05) / (darker + 0.05);
};

/** Picks the text color that reaches the higher contrast ratio against the given tile color. */
export const tileForegroundColor = (hex: string): string =>
  contrastRatio(hex, LIGHT_TILE_FOREGROUND) >= contrastRatio(hex, DARK_TILE_FOREGROUND)
    ? LIGHT_TILE_FOREGROUND
    : DARK_TILE_FOREGROUND;

/**
 * Keeps a 3 character abbreviation inside the tile without a cut. The count is in graphemes,
 * because a decomposed accent takes two UTF-16 units but only one tile column.
 */
export const tileLabelSizeClass = (label: string): string =>
  graphemesOf(label).length >= 3 ? "text-[0.625rem]" : "text-xs";

/** The opaque color face, with a label color picked by contrast. Carries no active marker. */
export const tileColorFaceStyle = (hex: string): CSSProperties => ({
  backgroundColor: hex,
  color: tileForegroundColor(hex),
});

const NO_COLOR_TILE_CLASSES = {
  active: "bg-primary text-primary-foreground hover:bg-primary",
  inactive: "bg-workspace-rail-tile hover:bg-workspace-rail-tile",
} satisfies Record<"active" | "inactive", string>;

/**
 * Theme classes for a tile whose workspace has no picked color. The primary accent marks the
 * selected tile, and the card surface keeps every other tile neutral.
 */
export const noColorTileClasses = (isActive: boolean): string =>
  NO_COLOR_TILE_CLASSES[isActive ? "active" : "inactive"];
