import { type ReactElement, type ReactNode, useEffect, useEffectEvent, useState } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import Animated, {
  type EntryExitAnimationFunction,
  FadeInDown,
  LayoutAnimationConfig,
  ReduceMotion,
  withTiming,
} from "react-native-reanimated";
import { motion } from "@/theme/tokens";

const SWAP_DISTANCE = 6;
const SWAP_ENTERING = FadeInDown.duration(motion.base)
  .easing(motion.easeOutCurve)
  .withInitialValues({ transform: [{ translateY: SWAP_DISTANCE }] })
  .reduceMotion(ReduceMotion.System);
const SWAP_LEAVE = {
  duration: motion.press,
  easing: motion.easeOutCurve,
  reduceMotion: ReduceMotion.System,
};
/** The old content leaves upward and faster than the new content arrives, so they do not blur. */
const SWAP_EXITING: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
    animations: {
      opacity: withTiming(0, SWAP_LEAVE),
      transform: [{ translateY: withTiming(-SWAP_DISTANCE, SWAP_LEAVE) }],
    },
  };
};

/**
 * Rolls its content when `swapKey` changes. The old content fades out upward while the new content
 * rises into its place. The first content and the removal of the slot do not animate.
 *
 * An exit starts at full opacity, so each content stays until its entry ends. Faster changes show
 * only the newest content.
 */
export function SwapTransition({
  swapKey,
  style,
  children,
}: {
  swapKey: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}): ReactElement {
  const [shown, setShown] = useState(() => ({ key: swapKey, children, at: 0 }));
  const showLatest = useEffectEvent(() => setShown({ key: swapKey, children, at: Date.now() }));
  useEffect(() => {
    if (swapKey === shown.key) return;
    const timer = setTimeout(showLatest, Math.max(0, shown.at + motion.base - Date.now()));
    return () => clearTimeout(timer);
  }, [swapKey, shown]);
  return (
    <LayoutAnimationConfig skipEntering skipExiting>
      <View style={style}>
        <Animated.View key={shown.key} entering={SWAP_ENTERING} exiting={SWAP_EXITING}>
          {swapKey === shown.key ? children : shown.children}
        </Animated.View>
      </View>
    </LayoutAnimationConfig>
  );
}
