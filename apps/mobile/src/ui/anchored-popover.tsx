import {
  type ComponentRef,
  type PropsWithChildren,
  type ReactElement,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type AccessibilityRole,
  Modal,
  Platform,
  Pressable,
  type ScaledSize,
  useWindowDimensions,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { type EdgeInsets, useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { scheduleOnRN } from "react-native-worklets";
import { useMenuCoversToasts } from "@/feedback/feedback-host";
import { motion } from "@/theme/tokens";
import { type PopoverPlacement, placePopover } from "./popover-placement";

/** The place of an open card on the screen, and its width. */
type OpenPlacement = PopoverPlacement & { width: number };

/** The size of a card for the window and its safe area at the time it opens. */
export type PopoverCardSize = (
  screen: ScaledSize,
  insets: EdgeInsets,
) => { width: number; height: number };

export type AnchoredPopoverState = {
  /** The view that the card anchors to. */
  trigger: RefObject<ComponentRef<typeof View> | null>;
  placement: OpenPlacement | null;
  progress: SharedValue<number>;
  show: () => void;
  /**
   * Closes the card. `after` runs at once on Android, where each modal has its own dialog window,
   * so a chosen action opens its screen while the card fades. On iOS it runs when the card has
   * left the screen, so it can open another modal or a native picker: iOS cannot present one
   * while the card is still presented.
   */
  close: (after?: () => void) => void;
  /** The `onDismiss` of the iOS modal: it runs the pending `after`. */
  dismissed: () => void;
};

/**
 * The open state of a card anchored to a trigger view, with its open and close animation. The
 * card size comes from `cardSize` when the card opens, so a closed card, such as the menu of each
 * list row, does no layout work.
 */
export const useAnchoredPopover = (cardSize: PopoverCardSize): AnchoredPopoverState => {
  const insets = useSafeAreaInsets();
  const trigger = useRef<ComponentRef<typeof View>>(null);
  const [placement, setPlacement] = useState<OpenPlacement | null>(null);
  const progress = useSharedValue(0);
  const afterClose = useRef<(() => void) | null>(null);
  const screen = useWindowDimensions();
  // The card size and the window are read when the card opens, so `show` keeps its identity.
  const latest = useRef({ cardSize, screen });
  useLayoutEffect(() => {
    latest.current = { cardSize, screen };
  });
  const show = useCallback(() => {
    trigger.current?.measureInWindow((x, y, triggerWidth, height) => {
      const { cardSize: sizeOf, screen } = latest.current;
      const size = sizeOf(screen, insets);
      setPlacement({
        ...placePopover({ x, y, width: triggerWidth, height }, size, screen, insets),
        width: size.width,
      });
      progress.set(0);
      progress.set(withTiming(1, { duration: 160, easing: motion.easeOutCurve }));
    });
  }, [insets, progress]);
  const dismissed = useCallback(() => {
    const after = afterClose.current;
    afterClose.current = null;
    after?.();
  }, []);
  const hide = useCallback(() => setPlacement(null), []);
  const close = useCallback(
    (after?: () => void) => {
      if (after && Platform.OS === "ios") {
        // The modal `onDismiss` runs it after UIKit has removed the card. A tap on the scrim
        // during the fade keeps the chosen action.
        afterClose.current = after;
      } else {
        after?.();
      }
      progress.set(
        withTiming(0, { duration: 110, easing: motion.easeOutCurve }, (finished) => {
          if (finished) scheduleOnRN(hide);
        }),
      );
    },
    [hide, progress],
  );
  return { trigger, placement, progress, show, close, dismissed };
};

type CardProps = PropsWithChildren<{
  accessibilityRole?: AccessibilityRole | undefined;
  accessibilityLabel?: string | undefined;
}>;

/**
 * A card anchored to its trigger, as the desktop dropdowns and popovers: a surface with an
 * outline and a shadow over a light scrim. A tap outside the card closes it.
 */
export function AnchoredPopover({
  popover,
  children,
  ...card
}: CardProps & { popover: AnchoredPopoverState }): ReactElement {
  const { placement, close } = popover;
  return (
    <Modal
      visible={placement !== null}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => close()}
      onDismiss={popover.dismissed}
    >
      {/* Only an open card mounts its animated styles, so a closed menu in a list row costs none. */}
      {placement ? (
        <PopoverCard {...card} popover={popover} placement={placement}>
          {children}
        </PopoverCard>
      ) : null}
    </Modal>
  );
}

function PopoverCard({
  popover,
  placement,
  accessibilityRole,
  accessibilityLabel,
  children,
}: CardProps & { popover: AnchoredPopoverState; placement: OpenPlacement }): ReactElement {
  useMenuCoversToasts(true);
  const { progress, close } = popover;
  const reducedMotion = useReducedMotion();
  const cardStyle = useAnimatedStyle(() => {
    const value = progress.get();
    return {
      opacity: value,
      transform: [{ scale: reducedMotion ? 1 : interpolate(value, [0, 1], [0.94, 1]) }],
    };
  });
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  return (
    // A modal is its own native window, so its touches need their own gesture root.
    <GestureHandlerRootView style={styles.root}>
      <Pressable
        style={styles.backdrop}
        onPress={() => close()}
        accessibilityRole="button"
        accessibilityLabel="Close"
      >
        <Animated.View style={[styles.scrim, scrimStyle]} />
      </Pressable>
      <View
        pointerEvents="box-none"
        style={[
          styles.slot,
          { width: placement.width, top: placement.top, left: placement.left },
          placement.height === null
            ? null
            : { height: placement.height, justifyContent: "flex-end" },
        ]}
      >
        <Animated.View
          accessibilityViewIsModal
          accessibilityRole={accessibilityRole}
          accessibilityLabel={accessibilityLabel}
          style={[
            styles.card,
            { maxHeight: placement.maxHeight, transformOrigin: placement.origin },
            cardStyle,
          ]}
        >
          {children}
        </Animated.View>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1 },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  scrim: { flex: 1, backgroundColor: theme.colors.scrimSoft },
  slot: { position: "absolute" },
  card: {
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    boxShadow: theme.shadows.overlay,
  },
}));
