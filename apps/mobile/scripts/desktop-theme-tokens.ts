/// <reference types="bun-types" />
// Builds the mobile color tokens from the desktop theme, so both apps keep one color source.
// React Native has no `oklch()`, `color-mix()`, or `var()`, so this script resolves each token to sRGB.
// Run `bun run scripts/desktop-theme-tokens.ts` after a change to packages/theme/src/tokens.css.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  colorResolver,
  type Declarations,
  readBlock,
  readDeclarations,
  toHex,
} from "@openducktor/theme/colors";
import { readThemeBlocks, TOKENS_FILE } from "@openducktor/theme/blocks";

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
  const blocks = readThemeBlocks(themeCss);
  const light = readDeclarations(blocks.light);
  const dark = new Map([...light, ...readDeclarations(blocks.dark)]);
  const build = (declarations: Declarations) => {
    const resolveVariable = colorResolver(declarations, palette);
    return Object.fromEntries(
      DESKTOP_TOKEN_NAMES.map((name) => [camelCase(name), toHex(resolveVariable(name))]),
    );
  };
  const resolvePalette = colorResolver(palette);
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
    "// Generated by scripts/desktop-theme-tokens.ts from packages/theme/src/tokens.css.",
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
    readFileSync(TOKENS_FILE, "utf8"),
    readFileSync(TAILWIND_PALETTE_PATH, "utf8"),
  );

if (import.meta.main) {
  writeFileSync(GENERATED_TOKENS_PATH, renderDesktopColorsModule(readDesktopThemeColors()));
  console.info(`Wrote ${GENERATED_TOKENS_PATH}`);
}
