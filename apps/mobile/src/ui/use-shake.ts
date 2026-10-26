import { useCallback } from "react";
import {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { haptics } from "./haptics";

/**
 * A short sideways shake with an error haptic, for the element whose action failed. With reduced
 * motion, only the haptic plays; the failure message carries the meaning.
 */
export const useShake = () => {
  const reducedMotion = useReducedMotion();
  const offset = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));
  const shake = useCallback(() => {
    haptics.error();
    if (reducedMotion) return;
    offset.set(
      withSequence(
        withTiming(-7, { duration: 45 }),
        withRepeat(withTiming(7, { duration: 90 }), 3, true),
        withTiming(0, { duration: 45 }),
      ),
    );
  }, [offset, reducedMotion]);
  return { style, shake };
};
