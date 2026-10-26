import type { KanbanColumnId } from "@openducktor/core";
import { type Insets, Platform, type TextStyle, type ViewStyle } from "react-native";
import { type CSSStyle, cubicBezier, Easing } from "react-native-reanimated";
import { withAlpha } from "./color-alpha";
import { type SemanticColors, semanticColors } from "./colors";
import { desktopColors, paletteColors } from "./desktop-colors";

export type FontWeightName = "regular" | "medium" | "semibold" | "bold";

const WEIGHT_VALUES = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const satisfies Record<FontWeightName, NonNullable<TextStyle["fontWeight"]>>;

/**
 * The desktop fonts: Space Grotesk for text and IBM Plex Mono for code, embedded at build time.
 * iOS selects each weight by its PostScript name. Android selects the weight in one font family.
 */
const ios = Platform.OS === "ios";
const fonts = {
  sans: {
    regular: ios ? "SpaceGrotesk-Regular" : "SpaceGrotesk",
    medium: ios ? "SpaceGrotesk-Medium" : "SpaceGrotesk",
    semibold: ios ? "SpaceGrotesk-SemiBold" : "SpaceGrotesk",
    bold: ios ? "SpaceGrotesk-Bold" : "SpaceGrotesk",
  },
  mono: {
    regular: ios ? "IBMPlexMono-Regular" : "IBMPlexMono",
    medium: ios ? "IBMPlexMono-Medium" : "IBMPlexMono",
    semibold: ios ? "IBMPlexMono-SemiBold" : "IBMPlexMono",
    bold: ios ? "IBMPlexMono-SemiBold" : "IBMPlexMono",
  },
  icons: ios ? "lucide" : "Lucide",
} as const;

/** The font family and weight of one weight, for a style. */
export const sansWeight = (weight: FontWeightName) => ({
  fontFamily: fonts.sans[weight],
  fontWeight: WEIGHT_VALUES[weight],
});

/** The mono ramp of code and paths, beside the sans ramp of `theme.type`. */
export const MONO_TYPE = {
  mono: { fontSize: 13, lineHeight: 19 },
  monoSmall: { fontSize: 11.5, lineHeight: 16 },
} as const;

export const monoWeight = (weight: FontWeightName) => ({
  fontFamily: fonts.mono[weight],
  fontWeight: weight === "bold" ? WEIGHT_VALUES.semibold : WEIGHT_VALUES[weight],
});

type TypeStyle = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  fontWeight: NonNullable<TextStyle["fontWeight"]>;
  letterSpacing: number;
};

type TypeVariant =
  | "largeTitle"
  | "title1"
  | "title2"
  | "title3"
  | "headline"
  | "body"
  | "callout"
  | "subhead"
  | "footnote"
  | "caption1"
  | "caption2";

const step = (
  fontSize: number,
  lineHeight: number,
  weight: FontWeightName,
  letterSpacing: number,
): TypeStyle => ({ ...sansWeight(weight), fontSize, lineHeight, letterSpacing });

/**
 * One type ramp on both platforms, sized for a phone. Space Grotesk has a large x-height, so a
 * 15-point body reads like a 16-point system font. Sizes follow the system text size.
 */
const type = {
  largeTitle: step(28, 34, "bold", -0.6),
  title1: step(24, 30, "bold", -0.5),
  title2: step(20, 26, "semibold", -0.3),
  title3: step(17, 22, "semibold", -0.2),
  headline: step(15, 20, "semibold", -0.1),
  body: step(15, 22, "regular", 0),
  callout: step(14, 20, "regular", 0),
  subhead: step(13, 18, "regular", 0),
  footnote: step(12, 16, "regular", 0.1),
  caption1: step(12, 16, "medium", 0.1),
  caption2: step(11, 14, "semibold", 0.2),
} satisfies Record<TypeVariant, TypeStyle>;

/** A 4-point spacing scale. Row gaps are smaller than group gaps, and group gaps than section gaps. */
const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

/** The desktop radii: cards 16, controls 10 to 12, badges as capsules. */
export const radius = { xs: 6, sm: 8, md: 10, lg: 12, xl: 16, xxl: 20, pill: 999 } as const;

/** Screen edge padding and the readable width on tablets. */
const layout = {
  screenPadding: 16,
  /** The leading inset of a row separator after a 32-point leading tile. */
  rowIconInset: 60,
  readableWidth: 680,
} as const;

/** The platform minimum touch target: 44 points on iOS, 48 dp on Android. */
const touchTarget = Platform.select({ ios: 44, default: 48 });

/**
 * The touch slop on each side that brings a control of `size` points to the touch target. Two
 * neighbors that stand the sum of their slops apart have touch areas that do not overlap.
 */
export const touchSlop = (size: number): number => Math.max(0, (touchTarget - size) / 2);

/** The slop above and below a control that is wide enough but not tall enough. */
export const verticalTouchSlop = (height: number): Insets => ({
  top: touchSlop(height),
  bottom: touchSlop(height),
});

/** The desktop shadows. Dark mode lifts surfaces with color, so cards have no shadow there. */
const shadows = {
  light: {
    card: "0 1px 2px rgba(15, 23, 42, 0.05)",
    raised: "0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 16px -4px rgba(15, 23, 42, 0.12)",
    overlay: "0 16px 40px -12px rgba(15, 23, 42, 0.28)",
    primary: "0 1px 2px rgba(81, 0, 255, 0.2), 0 4px 12px -4px rgba(81, 0, 255, 0.45)",
    /** The desktop chat card shadows: `shadow-chat` and `shadow-chat-focus`. */
    chat: "0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 4px 16px -4px rgba(15, 23, 42, 0.1)",
    chatFocus: "0 1px 3px 0 rgba(15, 23, 42, 0.06), 0 8px 20px -8px rgba(15, 23, 42, 0.2)",
    /** The thumb of a switch. */
    thumb: "0 1px 3px rgba(15, 23, 42, 0.25)",
  },
  dark: {
    card: "none",
    raised: "0 1px 2px rgba(0, 0, 0, 0.25), 0 4px 16px -4px rgba(0, 0, 0, 0.4)",
    overlay: "0 16px 40px -12px rgba(0, 0, 0, 0.7)",
    primary: "0 4px 14px -4px rgba(81, 0, 255, 0.6)",
    chat: "0 1px 2px 0 rgba(0, 0, 0, 0.25), 0 4px 16px -4px rgba(0, 0, 0, 0.35)",
    chatFocus: "0 1px 3px 0 rgba(0, 0, 0, 0.3), 0 8px 20px -8px rgba(0, 0, 0, 0.6)",
    thumb: "0 1px 3px rgba(15, 23, 42, 0.25)",
  },
} as const;

/** Shared motion values, so animations across the app feel related. */
export const motion = {
  /** Press feedback. */
  press: 110,
  /** A toggle, chip, or small state change. */
  fast: 180,
  /** An element that enters or exits. */
  base: 240,
  /** For Reanimated CSS transitions and animations. */
  easeOut: cubicBezier(0.23, 1, 0.32, 1),
  easeInOut: cubicBezier(0.77, 0, 0.175, 1),
  /** The same curves for `withTiming` and layout animations. */
  easeOutCurve: Easing.bezier(0.23, 1, 0.32, 1),
  easeInOutCurve: Easing.bezier(0.77, 0, 0.175, 1),
  /** A settle without overshoot, for a press release or a moved indicator. */
  settle: { duration: 320, dampingRatio: 1 },
  /** A spring for a moved or dismissed element after a gesture. */
  spring: { duration: 380, dampingRatio: 0.82 },
} as const;

/** The slow pulse of a loading placeholder, as the desktop skeletons. */
export const SKELETON_PULSE: CSSStyle<ViewStyle> = {
  animationName: { from: { opacity: 1 }, to: { opacity: 0.55 } },
  animationDuration: 900,
  animationIterationCount: "infinite",
  animationDirection: "alternate",
  animationTimingFunction: "ease-in-out",
};

/** Fades in after a short delay, so a fast load shows no placeholder flash. */
export const DELAYED_FADE_IN: CSSStyle<ViewStyle> = {
  animationName: { from: { opacity: 0 }, to: { opacity: 1 } },
  animationDuration: 200,
  animationDelay: 300,
  animationFillMode: "both",
};

/** `surface` washes a badge, `border` outlines it, `text` colors its label, `accent` a dot. */
export type ToneColors = { surface: string; border: string; text: string; accent: string };

export type Tone =
  | "neutral"
  | "primary"
  | "info"
  | "success"
  | "warning"
  | "destructive"
  | "pending"
  | "cancelled"
  | "rejected"
  | "running"
  | "review"
  | "approval";

const buildTones = (c: SemanticColors) => {
  const neutral = { surface: c.fill, border: c.border, text: c.secondaryLabel, accent: c.gray };
  const sky = { surface: c.blueSoft, border: c.blueBorder, text: c.blueText, accent: c.blue };
  const rose = { surface: c.redSoft, border: c.redBorder, text: c.redText, accent: c.red };
  return {
    neutral,
    primary: { surface: c.tintSoft, border: c.tintBorder, text: c.tint, accent: c.tint },
    info: sky,
    running: sky,
    success: { surface: c.greenSoft, border: c.greenBorder, text: c.greenText, accent: c.green },
    warning: { surface: c.amberSoft, border: c.amberBorder, text: c.amberText, accent: c.amber },
    cancelled: {
      surface: c.orangeSoft,
      border: c.orangeBorder,
      text: c.orangeText,
      accent: c.orange,
    },
    destructive: rose,
    rejected: rose,
    pending: {
      surface: c.purpleSoft,
      border: c.purpleBorder,
      text: c.purpleText,
      accent: c.purple,
    },
    review: { surface: c.indigoSoft, border: c.indigoBorder, text: c.indigoText, accent: c.indigo },
    approval: { surface: c.tealSoft, border: c.tealBorder, text: c.tealText, accent: c.teal },
  } satisfies Record<Tone, ToneColors>;
};

const LANE_TONES = {
  open: "neutral",
  spec_ready: "pending",
  ready_for_dev: "info",
  in_progress: "warning",
  blocked: "destructive",
  ai_review: "review",
  human_review: "approval",
  closed: "success",
} as const satisfies Record<KanbanColumnId, Tone>;

/** Mixes two `#rrggbb` colors. `amount` is the share of `top`. */
const mix = (top: string, bottom: string, amount: number): string => {
  const channel = (hex: string, index: number) =>
    Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  const parts = [0, 1, 2].map((index) =>
    Math.round(channel(top, index) * amount + channel(bottom, index) * (1 - amount))
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${parts.join("")}`;
};

/**
 * The colors of each board lane, as the desktop columns: a tinted board surface, an outline, an
 * accent bar, and the count text. Tinted surfaces are solid, so the board can blend them.
 */
type LaneColors = { wash: string; border: string; accent: string; text: string };

const buildLanes = (
  scheme: "light" | "dark",
  c: SemanticColors,
  tones: Record<Tone, ToneColors>,
) => {
  const lane = (columnId: KanbanColumnId): LaneColors => {
    const tone = tones[LANE_TONES[columnId]];
    // A dark wash has an alpha channel; the lane blends only its solid accent into the canvas.
    const wash =
      scheme === "light"
        ? mix(tone.surface.slice(0, 7), c.background, columnId === "open" ? 0 : 0.7)
        : mix(tone.accent, c.background, columnId === "open" ? 0 : 0.07);
    return { wash, border: tone.border, accent: tone.accent, text: tone.text };
  };
  return {
    open: lane("open"),
    spec_ready: lane("spec_ready"),
    ready_for_dev: lane("ready_for_dev"),
    in_progress: lane("in_progress"),
    blocked: lane("blocked"),
    ai_review: lane("ai_review"),
    human_review: lane("human_review"),
    closed: lane("closed"),
  } satisfies Record<KanbanColumnId, LaneColors>;
};

const buildTheme = (scheme: "light" | "dark") => {
  const semantic = semanticColors[scheme];
  const desktop = desktopColors[scheme];
  const tones = buildTones(semantic);
  return {
    scheme,
    colors: {
      ...semantic,
      /** The selected segment of a segmented control. */
      segmentThumb: desktop.segmentedSelected,
      /**
       * The `selectionColor` of a text input. iOS draws the caret and the selection handles in
       * it and makes the highlight lighter by itself, so iOS takes the full tint. Android draws
       * only the highlight in it, so it takes a light violet that keeps the text readable.
       */
      selection: ios ? semantic.tint : withAlpha(semantic.tint, 0.25),
      /** `bg-muted/30`: a recessed area, such as a code block, a quote, or an image frame. */
      insetFill: withAlpha(desktop.muted, 0.3),
      /** `bg-muted/40`: a muted card or strip that sets details apart, such as a conflict strip. */
      panelFill: withAlpha(desktop.muted, 0.4),
      /** `bg-muted/50`: a box or a tile in a card, such as an icon tile or a disclosure. */
      nestedFill: withAlpha(desktop.muted, 0.5),
      /** `bg-muted/60`: a pill, an icon disc, a group bar, or a disabled field. */
      chipFill: withAlpha(desktop.muted, 0.6),
      /** `border-border/50`: the hairlines between the rows and bars of the review screens. */
      diffDivider: withAlpha(desktop.border, 0.5),
      /** `bg-destructive/10`: the wash behind an error strip or an error icon. */
      destructiveWash: withAlpha(desktop.destructive, 0.1),
      runtimeOpencode: desktop.odtRuntimeAccentOpencode,
      runtimeCodex: desktop.odtRuntimeAccentCodex,
      runtimeClaude: desktop.odtRuntimeAccentClaude,
      terminalSurface: desktop.terminalSurface,
      terminalPanel: desktop.terminalPanel,
      terminalBorder: desktop.terminalBorder,
      terminalForeground: desktop.terminalForeground,
      terminalMuted: desktop.terminalMuted,
      terminalSelection: desktop.terminalSelection,
      terminalSelectionInactive: desktop.terminalSelectionInactive,
    },
    tones,
    lanes: buildLanes(scheme, semantic, tones),
    /**
     * Every desktop theme color by its CSS variable name in camel case, so a screen can use the
     * exact desktop token: `text-warning-muted` is `theme.desktop.warningMuted`.
     */
    desktop,
    /** The Tailwind palette of the desktop, such as `theme.palette.rose600`. */
    palette: paletteColors,
    type,
    space,
    radius,
    layout,
    touchTarget,
    shadows: shadows[scheme],
    fonts,
    hairline: 1,
  };
};

export const lightTheme = buildTheme("light");
export const darkTheme = buildTheme("dark");
export type AppTheme = typeof lightTheme;
export type ThemeColorName = keyof AppTheme["colors"];
