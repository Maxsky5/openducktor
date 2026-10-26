import type { ReactElement } from "react";
import type { ViewStyle } from "react-native";
import Animated, { type CSSStyle, useReducedMotion } from "react-native-reanimated";
import { motion } from "@/theme/tokens";
import { Icon } from "./icon";

/** The chevron turns in native code, so a list of collapsible rows runs no worklet for it. */
const TURN_TRANSITION: CSSStyle<ViewStyle> = {
  transitionProperty: "transform",
  transitionDuration: motion.fast,
  transitionTimingFunction: motion.easeOut,
};
const OPEN: ViewStyle = { transform: [{ rotate: "0deg" }] };
const COLLAPSED: ViewStyle = { transform: [{ rotate: "-90deg" }] };

/** The chevron of a collapsible header: it points down while open and turns right when closed. */
export function CollapseChevron({
  collapsed,
  colorValue,
}: {
  collapsed: boolean;
  colorValue: string;
}): ReactElement {
  const reducedMotion = useReducedMotion();
  return (
    <Animated.View style={[collapsed ? COLLAPSED : OPEN, reducedMotion ? null : TURN_TRANSITION]}>
      <Icon name="chevron-down" size={14} colorValue={colorValue} />
    </Animated.View>
  );
}
