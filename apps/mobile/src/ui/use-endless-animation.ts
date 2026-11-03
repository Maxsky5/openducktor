import { useIsFocused } from "expo-router";
import type { ViewStyle } from "react-native";
import { type CSSStyle, useReducedMotion } from "react-native-reanimated";

/**
 * The style of an endless CSS animation, such as a turning loader or a pulse. Reduced motion
 * removes the animation. The animation pauses while a sheet or another screen covers its screen:
 * each animation step draws a new frame of the window, and on a busy device that drawing takes CPU
 * time from the JavaScript of the next tap.
 */
export const useEndlessAnimation = (style: CSSStyle<ViewStyle>): CSSStyle<ViewStyle> | null => {
  const reducedMotion = useReducedMotion();
  const focused = useIsFocused();
  if (reducedMotion) return null;
  return focused ? style : { ...style, animationPlayState: "paused" };
};
