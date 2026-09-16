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
];

const FALLBACK_PALETTE_HEX = "#64748b";

export const deriveWorkspaceInitials = (workspaceName: string): string => {
  const trimmedName = workspaceName.trim();
  if (!trimmedName) {
    return "?";
  }

  // Split on anything that is not a letter or a digit in any script, so a name such as
  // `Équipe Mobile` keeps its leading `É` and `_alpha` drops its leading underscore.
  const segments = trimmedName
    .split(/[^\p{L}\p{N}]+/u)
    .reduce<string[]>((nextSegments, segment) => {
      const trimmedSegment = segment.trim();
      if (trimmedSegment.length > 0) {
        nextSegments.push(trimmedSegment);
      }
      return nextSegments;
    }, []);

  if (segments.length >= 2) {
    return `${segments[0]?.[0] ?? ""}${segments[1]?.[0] ?? ""}`.toUpperCase();
  }

  return (segments[0] ?? trimmedName).slice(0, 2).toUpperCase();
};

const hashWorkspaceId = (workspaceId: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < workspaceId.length; index += 1) {
    hash ^= workspaceId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export type WorkspaceAutomaticTileColors = ReadonlyMap<string, string>;

/**
 * Assigns a palette color to every given workspace id. The set of ids is the only input, so the
 * assignment survives a restart, a rename, a rail reorder, and any other settings change.
 */
export const resolveAutomaticTileColors = (
  workspaceIds: readonly string[],
): WorkspaceAutomaticTileColors => {
  const paletteSize = WORKSPACE_TILE_PALETTE.length;
  const uniqueIds = [...new Set(workspaceIds)].sort((left, right) => (left < right ? -1 : 1));
  const takenIndexes = new Set<number>();
  const assignment = new Map<string, string>();

  for (const workspaceId of uniqueIds) {
    const preferredIndex = hashWorkspaceId(workspaceId) % paletteSize;
    let chosenIndex = preferredIndex;
    for (let offset = 0; offset < paletteSize; offset += 1) {
      const candidateIndex = (preferredIndex + offset) % paletteSize;
      if (!takenIndexes.has(candidateIndex)) {
        chosenIndex = candidateIndex;
        break;
      }
    }
    takenIndexes.add(chosenIndex);
    assignment.set(workspaceId, WORKSPACE_TILE_PALETTE[chosenIndex]?.hex ?? FALLBACK_PALETTE_HEX);
  }

  return assignment;
};

/**
 * Returns the color the user picked, or the automatic color of the workspace. An id outside the
 * given assignment keeps its own preferred palette color.
 */
export const resolveTileColor = ({
  workspaceId,
  pickedColor,
  automaticColors,
}: {
  workspaceId: string;
  pickedColor: string | null;
  automaticColors: WorkspaceAutomaticTileColors;
}): string => {
  if (pickedColor) {
    return pickedColor;
  }
  const preferredIndex = hashWorkspaceId(workspaceId) % WORKSPACE_TILE_PALETTE.length;
  return (
    automaticColors.get(workspaceId) ??
    WORKSPACE_TILE_PALETTE[preferredIndex]?.hex ??
    FALLBACK_PALETTE_HEX
  );
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

/** Keeps a 3 character abbreviation inside the tile without a cut. */
export const tileLabelSizeClass = (label: string): string =>
  label.length >= 3 ? "text-[0.625rem]" : "text-xs";

/** The opaque color face, with a label color picked by contrast. Carries no active marker. */
export const tileColorFaceStyle = (hex: string): CSSProperties => ({
  backgroundColor: hex,
  color: tileForegroundColor(hex),
});

export const ACTIVE_TILE_BORDER_WIDTH_PX = 4;

/**
 * The wide border that marks the active workspace. Its color is the theme primary accent, so it
 * never depends on the tile color.
 *
 * The border is drawn as an inset outline. That keeps the tile at its layout size, follows the
 * rounded corners, and leaves the focus ring alone, because the shared button focus state uses a
 * box shadow. The longhand properties are used because a `var()` value inside the `outline`
 * shorthand is mis-parsed by the test DOM.
 */
const activeTileBorderStyle = (): CSSProperties => ({
  outlineWidth: `${ACTIVE_TILE_BORDER_WIDTH_PX}px`,
  outlineStyle: "solid",
  outlineColor: "var(--primary)",
  outlineOffset: `-${ACTIVE_TILE_BORDER_WIDTH_PX}px`,
});

/**
 * Every tile shows its workspace color at full strength. Only the active tile adds the
 * primary-color border.
 *
 * A user can pick any shade, so a dimmed inactive face could reach the intensity of the
 * full-strength active face of a neighbor. The border carries the active state on its own, so the
 * color is free to identify the workspace in every state.
 */
export const tileSurfaceStyle = (
  hex: string,
  { isActive }: { isActive: boolean },
): CSSProperties =>
  isActive ? { ...tileColorFaceStyle(hex), ...activeTileBorderStyle() } : tileColorFaceStyle(hex);
