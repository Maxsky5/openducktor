import { withAlpha } from "./color-alpha";
import { desktopColors, paletteColors as palette } from "./desktop-colors";

/**
 * The semantic colors of the app. They come from the desktop theme and its Tailwind palette, so
 * the phone and the desktop app share one brand: slate neutrals, white cards, the OpenDucktor
 * violet, and the desktop status families. Both platforms use the same colors.
 *
 * Every color is a string, because Reanimated, SVG, and the WebView pages read colors too.
 */
export type SemanticColors = {
  /** The screen background behind cards and lists. */
  background: string;
  /** The same canvas for screens of grouped rows and forms. */
  groupedBackground: string;
  /** Cards, grouped rows, sheets, and bars. */
  surface: string;
  /** A surface in a card, such as a code block or a quoted message. */
  surfaceRaised: string;
  /** Quiet control backgrounds: fields, chips, segmented controls. */
  fill: string;
  /** The pressed highlight of rows and quiet controls. */
  fillStrong: string;
  label: string;
  secondaryLabel: string;
  tertiaryLabel: string;
  /** Placeholders and off controls. */
  quaternaryLabel: string;
  /** Hairlines between rows in a card. */
  separator: string;
  /** The outline of cards and controls. */
  border: string;
  /** The outline of fields and outline buttons. */
  borderStrong: string;
  /** The brand violet for text, icons, and focus. */
  tint: string;
  /** The brand violet behind white text, such as a primary button. */
  tintFill: string;
  /** The pressed state of a primary button. */
  tintFillPressed: string;
  /** A light wash of the brand violet for a selected row or chip. */
  tintSoft: string;
  /** The outline of a tinted control. */
  tintBorder: string;
  onTint: string;
  /** The color of a running session: sky on desktop. */
  running: string;
  blue: string;
  blueSoft: string;
  blueBorder: string;
  blueText: string;
  green: string;
  greenSoft: string;
  greenBorder: string;
  greenText: string;
  amber: string;
  amberSoft: string;
  amberBorder: string;
  amberText: string;
  orange: string;
  orangeSoft: string;
  orangeBorder: string;
  orangeText: string;
  red: string;
  redSoft: string;
  redBorder: string;
  redText: string;
  purple: string;
  purpleSoft: string;
  purpleBorder: string;
  purpleText: string;
  indigo: string;
  indigoSoft: string;
  indigoBorder: string;
  indigoText: string;
  teal: string;
  tealSoft: string;
  tealBorder: string;
  tealText: string;
  gray: string;
  graySoft: string;
  grayBorder: string;
  grayText: string;
  /** The dimmed layer behind an overlay. */
  scrim: string;
  /** The light layer behind a menu or popover, which keeps the screen readable. */
  scrimSoft: string;
};

type Family = "sky" | "emerald" | "amber" | "orange" | "rose" | "violet" | "indigo" | "cyan";

const shade = (family: Family | "slate", step: string): string => {
  const key = `${family}${step}`;
  if (!(key in palette)) throw new Error(`The desktop palette has no ${key} color.`);
  // SAFETY: the check above proves that the key names a palette color.
  return palette[key as keyof typeof palette];
};

/** Light: 500 accent, 50 wash, 200 outline, 700 text, as the desktop badges. */
const lightFamily = (family: Family) => ({
  accent: shade(family, "500"),
  soft: shade(family, "50"),
  border: shade(family, "200"),
  text: shade(family, "700"),
});

/** Dark: 400 accent, a 950 wash at half strength, 800 outline, 300 text, as the desktop badges. */
const darkFamily = (family: Family) => ({
  accent: shade(family, "400"),
  soft: withAlpha(shade(family, "950"), 0.5),
  border: shade(family, "800"),
  text: shade(family, "300"),
});

const statusColors = (family: (name: Family) => ReturnType<typeof lightFamily>) => {
  const sky = family("sky");
  const emerald = family("emerald");
  const amber = family("amber");
  const orange = family("orange");
  const rose = family("rose");
  const violet = family("violet");
  const indigo = family("indigo");
  const cyan = family("cyan");
  return {
    blue: sky.accent,
    blueSoft: sky.soft,
    blueBorder: sky.border,
    blueText: sky.text,
    green: emerald.accent,
    greenSoft: emerald.soft,
    greenBorder: emerald.border,
    greenText: emerald.text,
    amber: amber.accent,
    amberSoft: amber.soft,
    amberBorder: amber.border,
    amberText: amber.text,
    orange: orange.accent,
    orangeSoft: orange.soft,
    orangeBorder: orange.border,
    orangeText: orange.text,
    red: rose.accent,
    redSoft: rose.soft,
    redBorder: rose.border,
    redText: rose.text,
    purple: violet.accent,
    purpleSoft: violet.soft,
    purpleBorder: violet.border,
    purpleText: violet.text,
    indigo: indigo.accent,
    indigoSoft: indigo.soft,
    indigoBorder: indigo.border,
    indigoText: indigo.text,
    teal: cyan.accent,
    tealSoft: cyan.soft,
    tealBorder: cyan.border,
    tealText: cyan.text,
  };
};

const light: SemanticColors = {
  background: desktopColors.light.chatBackground,
  groupedBackground: desktopColors.light.chatBackground,
  surface: desktopColors.light.card,
  surfaceRaised: palette.slate50,
  fill: desktopColors.light.muted,
  fillStrong: palette.slate200,
  label: desktopColors.light.foreground,
  secondaryLabel: palette.slate600,
  tertiaryLabel: desktopColors.light.mutedForeground,
  quaternaryLabel: palette.slate400,
  separator: palette.slate100,
  border: desktopColors.light.border,
  borderStrong: desktopColors.light.input,
  tint: desktopColors.light.primary,
  tintFill: desktopColors.light.primary,
  tintFillPressed: "#4400d6",
  tintSoft: palette.violet50,
  tintBorder: palette.violet200,
  onTint: desktopColors.light.primaryForeground,
  running: desktopColors.light.statusRunning,
  ...statusColors(lightFamily),
  gray: palette.slate400,
  graySoft: palette.slate100,
  grayBorder: palette.slate200,
  grayText: palette.slate600,
  scrim: "#02061866",
  scrimSoft: "#0206180f",
};

const dark: SemanticColors = {
  background: desktopColors.dark.chatBackground,
  groupedBackground: desktopColors.dark.chatBackground,
  surface: desktopColors.dark.card,
  surfaceRaised: palette.slate800,
  fill: desktopColors.dark.muted,
  fillStrong: palette.slate700,
  label: desktopColors.dark.foreground,
  secondaryLabel: palette.slate300,
  tertiaryLabel: desktopColors.dark.mutedForeground,
  quaternaryLabel: palette.slate600,
  separator: palette.slate800,
  border: desktopColors.dark.border,
  borderStrong: palette.slate600,
  tint: palette.violet400,
  tintFill: desktopColors.dark.primary,
  tintFillPressed: "#4400d6",
  tintSoft: withAlpha(palette.violet950, 0.6),
  tintBorder: palette.violet800,
  onTint: desktopColors.dark.primaryForeground,
  running: desktopColors.dark.statusRunning,
  ...statusColors(darkFamily),
  gray: palette.slate500,
  graySoft: palette.slate800,
  grayBorder: palette.slate700,
  grayText: palette.slate300,
  scrim: "#000000a6",
  scrimSoft: "#00000040",
};

export const semanticColors = { light, dark } satisfies Record<"light" | "dark", SemanticColors>;
