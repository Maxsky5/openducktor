import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { type StyleProp, useWindowDimensions, type ViewStyle } from "react-native";
import { useKeyboardHandler } from "react-native-keyboard-controller";
import Animated, {
  measure,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

export type KeyboardInsetViewProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  /**
   * False sets the final inset once when the keyboard starts to move, and not on each frame. Use
   * it for content that refits on each size change, such as a terminal page, so the content gets
   * one new size for each keyboard change.
   */
  followFrames?: boolean;
  /**
   * Keeps the bottom safe area while the keyboard is closed. Use it for a column at the bottom
   * edge of a screen that covers the tab bar. The keyboard covers this space when it opens.
   */
  bottomSafeArea?: boolean;
  /**
   * True when a bar at the bottom of the column keeps the bottom safe area itself, with
   * `useBottomEdgePadding`. The keyboard covers that padding when it opens.
   */
  barSafeArea?: boolean;
}>;

/**
 * The bottom padding of a bar on the bottom edge of a screen that covers the tab bar, such as the
 * session composer: the bottom safe area and `padding`. Put the bar in a `KeyboardInsetView` with
 * `barSafeArea`. The keyboard then covers the safe area part, so the padding never changes size
 * while the keyboard moves.
 */
export const useBottomEdgePadding = (padding: number): ViewStyle => {
  const { bottom } = useSafeAreaInsets();
  return useMemo(() => ({ paddingBottom: bottom + padding }), [bottom, padding]);
};

/**
 * A column whose bottom stays above the keyboard. It measures its own place on the screen each
 * time the keyboard starts to open, so a navigation header, a tab bar, or a banner that moved it
 * after mount cannot leave its bottom under the keyboard.
 *
 * By default it follows the keyboard frame by frame on the UI thread, as the `translate-with-padding`
 * behavior of keyboard-controller does: the content moves up with a transform, and the column
 * changes the size of its content only once, when the keyboard is open or starts to close. A size
 * change on each frame would lay out the column, and each list in it, on each frame. The column
 * clips the content that the transform moves past its top.
 */
export function KeyboardInsetView({
  style,
  children,
  followFrames = true,
  bottomSafeArea = false,
  barSafeArea = false,
}: KeyboardInsetViewProps): ReactElement {
  const ref = useAnimatedRef<Animated.View>();
  const { height: windowHeight } = useWindowDimensions();
  const { bottom } = useSafeAreaInsets();
  const closedInset = bottomSafeArea ? bottom : 0;
  // The keyboard covers the bottom safe area that the column or its bar keeps.
  const covered = bottomSafeArea || barSafeArea ? bottom : 0;
  // The distance from the bottom of this view to the bottom of the screen.
  const gap = useSharedValue(0);
  // How far the keyboard reaches into this view now, and the content inset of the layout.
  const lift = useSharedValue(0);
  const inset = useSharedValue(0);

  useKeyboardHandler(
    {
      // The start event has the final keyboard height.
      onStart: (event) => {
        "worklet";
        if (event.height > 0) {
          const frame = measure(ref);
          if (frame) gap.set(Math.max(0, windowHeight - (frame.pageY + frame.height)));
        }
        if (!followFrames) {
          // The inset takes the place of the closed safe area padding.
          inset.set(Math.max(0, event.height - gap.get()));
          return;
        }
        // A close gives the content its full size at once. The transform keeps it in place.
        if (event.height === 0) inset.set(0);
      },
      onMove: (event) => {
        "worklet";
        if (followFrames) lift.set(Math.max(0, event.height - gap.get() - covered));
      },
      onInteractive: (event) => {
        "worklet";
        if (!followFrames) return;
        inset.set(0);
        lift.set(Math.max(0, event.height - gap.get() - covered));
      },
      onEnd: (event) => {
        "worklet";
        if (!followFrames) {
          inset.set(Math.max(0, event.height - gap.get()));
          return;
        }
        const target = Math.max(0, event.height - gap.get() - covered);
        inset.set(target);
        lift.set(target);
      },
    },
    [covered, followFrames, windowHeight],
  );

  const keyboardInset = useAnimatedStyle(() =>
    followFrames
      ? {
          paddingTop: inset.get(),
          paddingBottom: closedInset,
          transform: [{ translateY: -lift.get() }],
        }
      : { paddingBottom: Math.max(inset.get(), closedInset) },
  );
  if (!followFrames) {
    return (
      <Animated.View ref={ref} style={[style, keyboardInset]}>
        {children}
      </Animated.View>
    );
  }
  return (
    <Animated.View ref={ref} style={[style, styles.clip]}>
      <Animated.View style={[styles.fill, keyboardInset]}>{children}</Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  fill: { flex: 1 },
});
