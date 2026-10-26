/// <reference types="bun-types" />
// Builds the mobile color tokens from the desktop theme, so both apps keep one color source.
// React Native has no `oklch()`, `color-mix()`, or `var()`, so this script resolves each token to sRGB.
// Run `bun run scripts/desktop-theme-tokens.ts` after a change to packages/frontend/src/styles.css.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Desktop custom properties that the mobile theme uses, without the leading `--`. */
export const DESKTOP_TOKEN_NAMES = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "status-running",
  "status-running-foreground",
  "selected-surface",
  "selected-accent",
  "selected-control",
  "selected-control-foreground",
  "segmented-selected",
  "switch-checked",
  "switch-thumb",
  "chat-background",
  "chat-surface",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "destructive-surface",
  "destructive-surface-foreground",
  "destructive-border",
  "destructive-muted",
  "destructive-accent",
  "rejected-surface",
  "rejected-surface-foreground",
  "rejected-border",
  "rejected-muted",
  "success-surface",
  "success-surface-foreground",
  "success-border",
  "success-muted",
  "success-accent",
  "success-icon",
  "warning-surface",
  "warning-surface-foreground",
  "warning-border",
  "warning-surface-selected",
  "warning-muted",
  "warning-accent",
  "info-surface",
  "info-surface-foreground",
  "info-border",
  "info-surface-selected",
  "info-muted",
  "info-accent",
  "pending-surface",
  "pending-surface-foreground",
  "pending-border",
  "pending-muted",
  "pending-accent",
  "cancelled-surface",
  "cancelled-surface-foreground",
  "cancelled-border",
  "cancelled-muted",
  "cancelled-accent",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebar-foreground",
  "sidebar-border",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-muted-foreground",
  "sidebar-read-foreground",
  "status-read",
  "status-unread",
  "status-input-read",
  "status-input-unread",
  "studio-chrome",
  "studio-chrome-foreground",
  "odt-runtime-accent-opencode",
  "odt-runtime-accent-codex",
  "odt-runtime-accent-claude",
  "terminal-surface",
  "terminal-panel",
  "terminal-border",
  "terminal-foreground",
  "terminal-muted",
  "terminal-selection",
  "terminal-selection-inactive",
  "workspace-rail-tile",
  "rejected-ring",
  "success-ring",
  "warning-ring",
  "info-ring",
  "pending-ring",
  "cancelled-ring",
] as const;

/** Tailwind palette families and shades that desktop badges and lanes use. */
export const PALETTE_FAMILIES = [
  "slate",
  "violet",
  "sky",
  "amber",
  "rose",
  "emerald",
  "orange",
  "indigo",
  "cyan",
  "green",
  "blue",
  "red",
  "purple",
  "teal",
  "yellow",
] as const;
export const PALETTE_SHADES = [
  "50",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
  "950",
] as const;

type Rgba = { r: number; g: number; b: number; a: number };
type Declarations = Map<string, string>;

const readBlock = (css: string, selector: RegExp): Declarations => {
  const match = selector.exec(css);
  if (!match) throw new Error(`The desktop theme has no block that matches ${selector.source}.`);
  const body = css.slice(match.index + match[0].length, css.indexOf("\n}", match.index));
  const declarations: Declarations = new Map();
  for (const declaration of body.replace(/\/\*[\s\S]*?\*\//g, "").split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const name = declaration.slice(0, separator).trim();
    if (!name.startsWith("--")) continue;
    declarations.set(
      name.slice(2),
      declaration
        .slice(separator + 1)
        .replace(/\s+/g, " ")
        .trim(),
    );
  }
  return declarations;
};

const clamp = (value: number) => Math.min(1, Math.max(0, value));

const oklabToRgb = (lightness: number, a: number, b: number, alpha: number): Rgba => {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const encode = (linear: number) =>
    clamp(linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055);
  return {
    r: encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: alpha,
  };
};

const rgbToOklab = ({ r, g, b }: Rgba): [number, number, number] => {
  const decode = (encoded: number) =>
    encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
  const [lr, lg, lb] = [decode(r), decode(g), decode(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

const parseNumber = (value: string): number =>
  value.endsWith("%") ? Number.parseFloat(value) / 100 : Number.parseFloat(value);

/** Splits on top-level commas, so nested functions stay whole. */
const splitArguments = (value: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of value) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += character;
  }
  parts.push(current.trim());
  return parts;
};

type Resolver = (name: string) => Rgba;

const mix = (space: string, first: Rgba, second: Rgba, weight: number): Rgba => {
  const alpha = first.a * weight + second.a * (1 - weight);
  if (space === "srgb") {
    const channel = (left: number, right: number) =>
      alpha === 0 ? 0 : (left * first.a * weight + right * second.a * (1 - weight)) / alpha;
    return {
      r: channel(first.r, second.r),
      g: channel(first.g, second.g),
      b: channel(first.b, second.b),
      a: alpha,
    };
  }
  const left = rgbToOklab(first);
  const right = rgbToOklab(second);
  const premultiplied = (index: 0 | 1 | 2) =>
    alpha === 0
      ? 0
      : (left[index] * first.a * weight + right[index] * second.a * (1 - weight)) / alpha;
  if (space === "oklab")
    return oklabToRgb(premultiplied(0), premultiplied(1), premultiplied(2), alpha);
  if (space !== "oklch") throw new Error(`The color-mix space ${space} is not supported.`);
  const chroma = (lab: [number, number, number]) => Math.hypot(lab[1], lab[2]);
  const hue = (lab: [number, number, number]) => Math.atan2(lab[2], lab[1]);
  const [leftChroma, rightChroma] = [chroma(left), chroma(right)];
  // An achromatic color has no hue, so the mix takes the hue of the other color.
  const leftHue = leftChroma < 1e-4 ? hue(right) : hue(left);
  const rightHue = rightChroma < 1e-4 ? leftHue : hue(right);
  let delta = rightHue - leftHue;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  const mixedHue = leftHue + delta * (1 - weight);
  const mixedChroma =
    alpha === 0
      ? 0
      : (leftChroma * first.a * weight + rightChroma * second.a * (1 - weight)) / alpha;
  return oklabToRgb(
    premultiplied(0),
    mixedChroma * Math.cos(mixedHue),
    mixedChroma * Math.sin(mixedHue),
    alpha,
  );
};

const parseColor = (value: string, resolveVariable: Resolver): Rgba => {
  const trimmed = value.trim();
  const variable = /^var\(--([a-z0-9-]+)\)$/.exec(trimmed);
  if (variable?.[1]) return resolveVariable(variable[1]);
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex;
    return {
      r: Number.parseInt(full.slice(0, 2), 16) / 255,
      g: Number.parseInt(full.slice(2, 4), 16) / 255,
      b: Number.parseInt(full.slice(4, 6), 16) / 255,
      a: full.length === 8 ? Number.parseInt(full.slice(6, 8), 16) / 255 : 1,
    };
  }
  const oklch = /^oklch\(([^)]+)\)$/.exec(trimmed);
  if (oklch?.[1]) {
    const [channels = "", alphaPart] = oklch[1].split("/");
    const [lightness = "0", chroma = "0", hue = "0"] = channels.trim().split(/\s+/);
    const radians = (parseNumber(hue) * Math.PI) / 180;
    const c = parseNumber(chroma);
    return oklabToRgb(
      parseNumber(lightness),
      c * Math.cos(radians),
      c * Math.sin(radians),
      alphaPart === undefined ? 1 : parseNumber(alphaPart.trim()),
    );
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(trimmed);
  if (rgb?.[1]) {
    const [channels = "", slashAlpha] = rgb[1].split("/");
    const parts = channels.includes(",")
      ? channels.split(",").map((part) => part.trim())
      : channels.trim().split(/\s+/);
    const alphaText = slashAlpha?.trim() ?? parts[3];
    return {
      r: parseNumber(parts[0] ?? "0") / 255,
      g: parseNumber(parts[1] ?? "0") / 255,
      b: parseNumber(parts[2] ?? "0") / 255,
      a: alphaText === undefined ? 1 : parseNumber(alphaText),
    };
  }
  const colorMix = /^color-mix\((.+)\)$/.exec(trimmed);
  if (colorMix?.[1]) {
    const [spaceText = "", firstText = "", secondText = ""] = splitArguments(colorMix[1]);
    const space = spaceText.replace(/^in\s+/, "").trim();
    const weighted = (text: string): [string, number | null] => {
      const percentage = /\s(\d+(?:\.\d+)?)%$/.exec(text);
      return percentage?.[1]
        ? [text.slice(0, percentage.index).trim(), Number.parseFloat(percentage[1]) / 100]
        : [text.trim(), null];
    };
    const [firstColor, firstWeight] = weighted(firstText);
    const [secondColor, secondWeight] = weighted(secondText);
    const weight = firstWeight ?? (secondWeight === null ? 0.5 : 1 - secondWeight);
    return mix(
      space,
      parseColor(firstColor, resolveVariable),
      parseColor(secondColor, resolveVariable),
      weight,
    );
  }
  throw new Error(`The desktop theme value ${trimmed} is not a supported color.`);
};

const toHex = ({ r, g, b, a }: Rgba): string => {
  const byte = (channel: number) =>
    Math.round(clamp(channel) * 255)
      .toString(16)
      .padStart(2, "0");
  const base = `#${byte(r)}${byte(g)}${byte(b)}`;
  return a >= 0.9995 ? base : `${base}${byte(a)}`;
};

const camelCase = (name: string) =>
  name.replace(/-([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());

export type DesktopThemeColors = {
  light: Record<string, string>;
  dark: Record<string, string>;
  palette: Record<string, string>;
};

/** Resolves the mobile token set from the desktop theme and the Tailwind palette. */
export const resolveDesktopThemeColors = (
  themeCss: string,
  paletteCss: string,
): DesktopThemeColors => {
  const palette = readBlock(paletteCss, /@theme default \{/);
  const light = readBlock(themeCss, /:root,\s*\.light \{/);
  const dark = new Map([...light, ...readBlock(themeCss, /\n\.dark \{/)]);
  const resolveIn = (declarations: Declarations): Resolver => {
    const resolving = new Set<string>();
    const resolveVariable: Resolver = (name) => {
      const value = declarations.get(name) ?? palette.get(name);
      if (value === undefined) throw new Error(`The desktop theme has no --${name} token.`);
      if (resolving.has(name)) throw new Error(`The desktop token --${name} refers to itself.`);
      resolving.add(name);
      try {
        return parseColor(value, resolveVariable);
      } finally {
        resolving.delete(name);
      }
    };
    return resolveVariable;
  };
  const build = (declarations: Declarations) => {
    const resolveVariable = resolveIn(declarations);
    return Object.fromEntries(
      DESKTOP_TOKEN_NAMES.map((name) => [camelCase(name), toHex(resolveVariable(name))]),
    );
  };
  const resolvePalette = resolveIn(palette);
  return {
    light: build(light),
    dark: build(dark),
    palette: Object.fromEntries(
      PALETTE_FAMILIES.flatMap((family) =>
        PALETTE_SHADES.map((shade) => [
          `${family}${shade}`,
          toHex(resolvePalette(`color-${family}-${shade}`)),
        ]),
      ),
    ),
  };
};

const repositoryRoot = resolve(import.meta.dir, "../../..");
export const DESKTOP_THEME_PATH = resolve(repositoryRoot, "packages/frontend/src/styles.css");
export const TAILWIND_PALETTE_PATH = resolve(
  repositoryRoot,
  "packages/frontend/node_modules/tailwindcss/theme.css",
);
export const GENERATED_TOKENS_PATH = resolve(import.meta.dir, "../src/theme/desktop-colors.ts");

export const renderDesktopColorsModule = (colors: DesktopThemeColors): string => {
  const record = (values: Record<string, string>) =>
    Object.entries(values)
      .map(([name, value]) => `    ${name}: "${value}",`)
      .join("\n");
  return [
    "// Generated by scripts/desktop-theme-tokens.ts from packages/frontend/src/styles.css.",
    "// Do not edit. Run `bun run scripts/desktop-theme-tokens.ts` in apps/mobile after a desktop theme change.",
    "export const desktopColors = {",
    "  light: {",
    record(colors.light),
    "  },",
    "  dark: {",
    record(colors.dark),
    "  },",
    "} as const;",
    "",
    "export const paletteColors = {",
    record(colors.palette).replace(/^ {4}/gm, "  "),
    "} as const;",
    "",
  ].join("\n");
};

export const readDesktopThemeColors = (): DesktopThemeColors =>
  resolveDesktopThemeColors(
    readFileSync(DESKTOP_THEME_PATH, "utf8"),
    readFileSync(TAILWIND_PALETTE_PATH, "utf8"),
  );

if (import.meta.main) {
  writeFileSync(GENERATED_TOKENS_PATH, renderDesktopColorsModule(readDesktopThemeColors()));
  console.info(`Wrote ${GENERATED_TOKENS_PATH}`);
}
