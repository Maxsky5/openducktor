import { useRecyclingState } from "@shopify/flash-list";
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { Pressable, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { scheduleOnRN } from "react-native-worklets";
import { haptics } from "@/ui/haptics";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";

const ACTION_WIDTH = 84;

/** Closes an open row. */
type SwipeRowHandle = { close: () => void };

/** Keeps one swiped row open at a time, and closes it when the list scrolls. */
export type SwipeRowGroup = {
  willOpen: (row: SwipeRowHandle) => void;
  closed: (row: SwipeRowHandle) => void;
  closeOpenRow: () => void;
};

export const useSwipeRowGroup = (): SwipeRowGroup => {
  const open = useRef<SwipeRowHandle | null>(null);
  return useMemo(
    () => ({
      willOpen: (row) => {
        if (open.current !== null && open.current !== row) open.current.close();
        open.current = row;
      },
      closed: (row) => {
        if (open.current === row) open.current = null;
      },
      closeOpenRow: () => {
        open.current?.close();
        open.current = null;
      },
    }),
    [],
  );
};

function SwipeAction({
  label,
  icon,
  progress,
  onPress,
}: {
  label: string;
  icon: IconName;
  progress: SharedValue<number>;
  onPress: () => void;
}): ReactElement {
  const reducedMotion = useReducedMotion();
  // The action grows into place as the row opens. Reduced motion keeps the fade only.
  const actionStyle = useAnimatedStyle(() => {
    const shown = progress.get();
    return {
      opacity: interpolate(shown, [0, 0.6], [0, 1], Extrapolation.CLAMP),
      transform: [
        { scale: reducedMotion ? 1 : interpolate(shown, [0, 1], [0.85, 1], Extrapolation.CLAMP) },
      ],
    };
  });
  return (
    <View style={styles.action}>
      <Animated.View style={[styles.actionFrame, actionStyle]}>
        <Touchable
          feedback="scale"
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={label}
          containerStyle={styles.actionTouch}
          style={styles.actionButton}
        >
          <Icon name={icon} size={18} color="onTint" />
          <Text variant="caption2" tone="onTint" numberOfLines={1}>
            {label}
          </Text>
        </Touchable>
      </Animated.View>
    </View>
  );
}

/** A swipe at this speed commits, also before it passes half of the action. */
const SWIPE_VELOCITY = 500;
const SETTLE = { duration: 300, dampingRatio: 0.85 } as const;

/**
 * A row of a group card that a swipe to the left opens on one action, as in Mail. The action is a
 * violet rounded button behind the row. The row snaps open with a light haptic, and a tap on the
 * action runs it. A tap on an open row closes it. The gesture runs on the UI thread. The same
 * action is always in the row menu too, so the swipe is never the only way to reach it.
 *
 * The swipe starts only on a sideways drag: a drag that moves up or down first fails it, so the
 * list scrolls even when the finger drifts sideways.
 *
 * A list cell can show another entry after a search, a fold, or a live update. A new `resetKey`
 * then closes the row, so the next entry does not show the action of the last one.
 */
export function SwipeRow({
  resetKey,
  label,
  icon,
  onAction,
  enabled,
  group,
  children,
}: {
  /** The identity of the entry that the row shows. */
  resetKey: string;
  label: string;
  icon: IconName;
  onAction: () => void;
  /** False for a row without the action. The row then has no action layer and no swipe. */
  enabled: boolean;
  group: SwipeRowGroup;
  children: ReactNode;
}): ReactElement {
  const offset = useSharedValue(0);
  const dragStart = useSharedValue(0);
  const [open, setOpen] = useRecyclingState(false, [resetKey]);
  const handle = useMemo<SwipeRowHandle>(
    () => ({
      close: () => {
        offset.set(withSpring(0, SETTLE));
        setOpen(false);
      },
    }),
    [offset, setOpen],
  );
  // The shared value cannot change while React renders, so the offset resets in this cleanup.
  useLayoutEffect(
    () => () => {
      offset.set(0);
      group.closed(handle);
    },
    [group, handle, offset, resetKey],
  );
  const settle = useCallback(
    (opened: boolean, wasOpen: boolean) => {
      setOpen(opened);
      if (opened) {
        // The swipe commits here: the row snaps open in this frame.
        if (!wasOpen) haptics.light();
        group.willOpen(handle);
      } else {
        group.closed(handle);
      }
    },
    [group, handle, setOpen],
  );
  const pan = usePanGesture({
    enabled,
    activeOffsetX: [-12, 12],
    failOffsetY: [-8, 8],
    onActivate: () => {
      dragStart.set(offset.get());
    },
    onUpdate: (event) => {
      const next = dragStart.get() + event.translationX;
      // The row resists a drag to the right of its place and past the action.
      let resisted = next;
      if (next > 0) resisted = next * 0.15;
      else if (next < -ACTION_WIDTH) resisted = -ACTION_WIDTH + (next + ACTION_WIDTH) / 8;
      offset.set(resisted);
    },
    onDeactivate: (event) => {
      const wasOpen = dragStart.get() < 0;
      const pastHalf = offset.get() < -ACTION_WIDTH / 2;
      const opens = pastHalf ? event.velocityX < SWIPE_VELOCITY : event.velocityX < -SWIPE_VELOCITY;
      offset.set(withSpring(opens ? -ACTION_WIDTH : 0, { ...SETTLE, velocity: event.velocityX }));
      scheduleOnRN(settle, opens, wasOpen);
    },
  });
  const progress = useDerivedValue(() =>
    interpolate(offset.get(), [-ACTION_WIDTH, 0], [1, 0], Extrapolation.CLAMP),
  );
  const frontStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));
  return (
    <View>
      {enabled ? (
        // A closed row hides its action from screen readers; the row menu has the same action.
        <View
          style={styles.actions}
          accessibilityElementsHidden={!open}
          importantForAccessibility={open ? "auto" : "no-hide-descendants"}
        >
          <SwipeAction
            label={label}
            icon={icon}
            progress={progress}
            onPress={() => {
              handle.close();
              onAction();
            }}
          />
        </View>
      ) : null}
      <GestureDetector gesture={pan}>
        <Animated.View style={frontStyle}>
          {/* While the row is open, a tap on it closes it instead of opening the row. */}
          <View pointerEvents={open ? "none" : "auto"}>{children}</View>
          {open ? (
            <Pressable
              style={styles.closeOverlay}
              onPress={handle.close}
              accessibilityRole="button"
              accessibilityLabel={`Close ${label}`}
            />
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The action sits behind the row at its trailing edge, and shows as the row slides.
  actions: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: ACTION_WIDTH,
  },
  closeOverlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  action: {
    width: ACTION_WIDTH,
    flex: 1,
    paddingVertical: theme.space.sm,
    paddingRight: theme.space.sm,
    paddingLeft: theme.space.xs,
  },
  actionFrame: { flex: 1 },
  actionTouch: { flex: 1 },
  actionButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    backgroundColor: theme.colors.tintFill,
    boxShadow: theme.shadows.primary,
  },
}));
