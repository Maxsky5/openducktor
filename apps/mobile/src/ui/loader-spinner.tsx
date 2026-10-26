import { memo, type ReactElement } from "react";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import Animated, { type CSSStyle, useReducedMotion } from "react-native-reanimated";
import { Icon } from "@/ui/icon";

const SPIN: CSSStyle<ViewStyle> = {
  animationName: {
    from: { transform: [{ rotate: "0deg" }] },
    to: { transform: [{ rotate: "360deg" }] },
  },
  animationDuration: 1000,
  animationIterationCount: "infinite",
  animationTimingFunction: "linear",
};

/**
 * The desktop `LoaderCircle animate-spin`: a turning Lucide loader while work runs. With reduced
 * motion, the loader stays still.
 */
export const LoaderSpinner = memo(function LoaderSpinner({
  size = 12,
  color,
  colorStyle,
}: {
  size?: number;
  color?: string | undefined;
  /** A theme style with the color, so a theme change repaints the loader without a render. */
  colorStyle?: StyleProp<TextStyle>;
}): ReactElement {
  const reducedMotion = useReducedMotion();
  return (
    <Animated.View
      style={reducedMotion ? null : SPIN}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Icon name="loader-circle" size={size} colorValue={color} colorStyle={colorStyle} />
    </Animated.View>
  );
});
