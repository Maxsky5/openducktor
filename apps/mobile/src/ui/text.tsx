import type { ReactElement } from "react";
import { Text as NativeText, type TextProps as NativeTextProps, Platform } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MONO_TYPE, monoWeight, sansWeight } from "@/theme/tokens";

export type TextVariant =
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
  | "caption2"
  | "mono"
  | "monoSmall";

type TextTone =
  | "label"
  | "secondary"
  | "tertiary"
  | "quaternary"
  | "tint"
  | "onTint"
  | "red"
  | "orange"
  | "amber"
  | "green"
  | "blue"
  | "purple"
  | "indigo"
  | "teal";

export type TextProps = NativeTextProps & {
  variant?: TextVariant;
  tone?: TextTone;
  weight?: "regular" | "medium" | "semibold" | "bold";
  /** Fixed-width digits for counts, times, and sizes. */
  tabular?: boolean;
  /** Small capitals with wide tracking, as the desktop section labels. */
  overline?: boolean;
};

type TextWeight = NonNullable<TextProps["weight"]>;

/**
 * All app text, on the desktop type ramp. Sizes follow the system text size. Each text picks plain
 * style entries instead of stylesheet variants, because a variant selection runs native code on
 * each render, and a board or a list renders hundreds of texts.
 */
export function Text({
  variant = "body",
  tone = "label",
  weight,
  tabular = false,
  overline = false,
  style,
  selectable,
  ...props
}: TextProps): ReactElement {
  const mono = variant === "mono" || variant === "monoSmall";
  // Android draws selectable text without its ellipsis, so one truncated line would clip.
  const truncatedLine = Platform.OS === "android" && props.numberOfLines === 1;
  return (
    <NativeText
      {...props}
      selectable={selectable && !truncatedLine}
      style={[
        styles[variant],
        styles[tone],
        weight === undefined ? null : styles[(mono ? MONO_WEIGHTS : SANS_WEIGHTS)[weight]],
        tabular ? styles.tabular : null,
        overline ? styles.overline : null,
        style,
      ]}
    />
  );
}

const SANS_WEIGHTS = {
  regular: "sansRegular",
  medium: "sansMedium",
  semibold: "sansSemibold",
  bold: "sansBold",
} as const satisfies Record<TextWeight, string>;

const MONO_WEIGHTS = {
  regular: "monoRegular",
  medium: "monoMedium",
  semibold: "monoSemibold",
  bold: "monoBold",
} as const satisfies Record<TextWeight, string>;

const styles = StyleSheet.create((theme) => ({
  largeTitle: theme.type.largeTitle,
  title1: theme.type.title1,
  title2: theme.type.title2,
  title3: theme.type.title3,
  headline: theme.type.headline,
  body: theme.type.body,
  callout: theme.type.callout,
  subhead: theme.type.subhead,
  footnote: theme.type.footnote,
  caption1: theme.type.caption1,
  caption2: theme.type.caption2,
  mono: { ...monoWeight("regular"), ...MONO_TYPE.mono, letterSpacing: 0 },
  monoSmall: { ...monoWeight("regular"), ...MONO_TYPE.monoSmall, letterSpacing: 0 },
  label: { color: theme.colors.label },
  secondary: { color: theme.colors.secondaryLabel },
  tertiary: { color: theme.colors.tertiaryLabel },
  quaternary: { color: theme.colors.quaternaryLabel },
  tint: { color: theme.colors.tint },
  onTint: { color: theme.colors.onTint },
  red: { color: theme.colors.redText },
  orange: { color: theme.colors.orangeText },
  amber: { color: theme.colors.amberText },
  green: { color: theme.colors.greenText },
  blue: { color: theme.colors.blueText },
  purple: { color: theme.colors.purpleText },
  indigo: { color: theme.colors.indigoText },
  teal: { color: theme.colors.tealText },
  sansRegular: sansWeight("regular"),
  sansMedium: sansWeight("medium"),
  sansSemibold: sansWeight("semibold"),
  sansBold: sansWeight("bold"),
  monoRegular: monoWeight("regular"),
  monoMedium: monoWeight("medium"),
  monoSemibold: monoWeight("semibold"),
  monoBold: monoWeight("bold"),
  tabular: { fontVariant: ["tabular-nums"] },
  overline: { letterSpacing: 0.8, textTransform: "uppercase" },
}));
