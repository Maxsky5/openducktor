import type { PropsWithChildren, ReactElement } from "react";
import {
  type DimensionValue,
  type StyleProp,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { DELAYED_FADE_IN, MONO_TYPE, SKELETON_PULSE } from "@/theme/tokens";
import type { TextVariant } from "./text";

/**
 * The frame of a skeleton: it fades in after a short delay, so a fast load shows no placeholder,
 * pulses unless the system reduces motion, and reads as one loading element.
 */
export function SkeletonFrame({
  label,
  children,
}: PropsWithChildren<{ label: string }>): ReactElement {
  const reducedMotion = useReducedMotion();
  return (
    <Animated.View
      style={DELAYED_FADE_IN}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      <Animated.View style={reducedMotion ? null : SKELETON_PULSE}>{children}</Animated.View>
    </Animated.View>
  );
}

/**
 * One line of text for a first load: a bar in a box as tall as a line of `variant` at the system
 * text size, so the loaded text takes its exact place.
 */
export function TextPlaceholder({
  variant = "body",
  width,
  maxFontScale,
  style,
}: {
  variant?: TextVariant | undefined;
  width: DimensionValue;
  /** The `maxFontSizeMultiplier` of the loaded text, in a row of fixed height. */
  maxFontScale?: number | undefined;
  style?: StyleProp<ViewStyle>;
}): ReactElement {
  const { fontScale } = useWindowDimensions();
  const scale = maxFontScale === undefined ? fontScale : Math.min(fontScale, maxFontScale);
  return (
    <View style={[styles.line(variant, scale), style]}>
      <View style={[styles.bar(variant), { width }]} />
    </View>
  );
}

type SansVariant = Exclude<TextVariant, "mono" | "monoSmall">;

/** The line height of `variant`, as `Text` draws it. */
const lineHeightOf = (
  sans: Readonly<Record<SansVariant, { lineHeight: number }>>,
  variant: TextVariant,
): number =>
  variant === "mono" || variant === "monoSmall"
    ? MONO_TYPE[variant].lineHeight
    : sans[variant].lineHeight;

const styles = StyleSheet.create((theme) => ({
  line: (variant: TextVariant, fontScale: number) => ({
    height: lineHeightOf(theme.type, variant) * fontScale,
    justifyContent: "center",
  }),
  // Half the line height: 11 points for `body`, 8 for `footnote`.
  bar: (variant: TextVariant) => ({
    height: Math.round(lineHeightOf(theme.type, variant) / 2),
    borderRadius: lineHeightOf(theme.type, variant) / 4,
    backgroundColor: theme.colors.fill,
  }),
}));
