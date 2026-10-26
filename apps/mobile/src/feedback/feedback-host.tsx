import { type ReactElement, useCallback, useEffect, useId, useState } from "react";
import { AccessibilityInfo, Platform, ScrollView, useWindowDimensions, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  FadeInUp,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";
import { StyleSheet } from "react-native-unistyles";
import { scheduleOnRN } from "react-native-worklets";
import { useStore } from "zustand";
import { useFeedbackStore } from "@/app-shell/app-services";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { motion, sansWeight } from "@/theme/tokens";
import { Icon, type IconName } from "@/ui/icon";
import { haptics } from "@/ui/haptics";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { ModalStartupProgressHost } from "@/features/session-startup/startup-progress-host";
import {
  type FeedbackMessage,
  type FeedbackStore,
  toastsCoveredBy,
  toastWindowOf,
} from "./feedback-store";

const KIND_ICONS = {
  success: "check",
  info: "info",
  warning: "triangle-alert",
  error: "x",
} as const satisfies Record<FeedbackMessage["kind"], IconName>;

/** A swipe that passes this distance or speed dismisses the toast. */
const SWIPE_DISTANCE = 48;
const SWIPE_VELOCITY = 600;
const SETTLE = { duration: 400, dampingRatio: 0.8 } as const;
/**
 * The toasts start this far below the top safe area, under the top bar of each screen and sheet,
 * so they never cover Back, Close, Done, or a header menu. The tallest bar is the 64-point header
 * of a full-screen Android sheet. The Android toolbar is 56 points, and the controls of an iOS page
 * sheet and of an Android route sheet end above 64 points.
 */
const TOP_BAR_CLEARANCE = 64 + 6;
const LEAVE = { duration: 180, easing: motion.easeOutCurve } as const;
const TOAST_ENTERING = FadeInUp.springify().duration(380).dampingRatio(0.82);
const TOAST_EXITING = FadeOut.duration(160);

/**
 * The announcement, the haptic, and the timer of one message. The root host runs them, so they run
 * once, also when the toast moves to another window.
 */
function FeedbackEffects({
  entry,
  dismiss,
}: {
  entry: FeedbackMessage;
  dismiss: (id: string) => void;
}): null {
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(
      entry.description ? `${entry.message}. ${entry.description}` : entry.message,
    );
    if (entry.kind === "success") haptics.success();
    if (entry.kind === "error") haptics.error();
    if (entry.duration === null) return;
    const timer = setTimeout(() => dismiss(entry.id), entry.duration);
    return () => clearTimeout(timer);
  }, [dismiss, entry]);
  return null;
}

function FeedbackToast({
  entry,
  feedback,
  exits,
}: {
  entry: FeedbackMessage;
  feedback: FeedbackStore;
  /** False in a modal window, which can slide out with a fading toast still in it. */
  exits: boolean;
}): ReactElement {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const { dismiss, markPresented } = feedback;
  const close = useCallback(() => dismiss(entry.id), [dismiss, entry.id]);
  // A toast that moves to another window, as when a sheet closes, shows there at once: one toast
  // that enters twice reads as two toasts.
  const [entering] = useState(() =>
    feedback.wasPresented(entry.id) ? {} : { entering: TOAST_ENTERING },
  );
  useEffect(() => markPresented(entry.id), [entry.id, markPresented]);

  // A swipe up or to a side dismisses the toast. A drag down resists, as the toast belongs at the
  // top edge. A short drag settles back with the speed of the finger.
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const pan = usePanGesture({
    minDistance: 8,
    onUpdate: (event) => {
      offsetX.set(event.translationX);
      offsetY.set(event.translationY < 0 ? event.translationY : event.translationY * 0.15);
    },
    onDeactivate: (event) => {
      const { translationX, translationY, velocityX, velocityY } = event;
      const sideways = Math.abs(translationX) > Math.abs(translationY);
      if (
        sideways &&
        (Math.abs(translationX) > SWIPE_DISTANCE || Math.abs(velocityX) > SWIPE_VELOCITY)
      ) {
        const side = Math.sign(translationX || velocityX);
        offsetX.set(
          withTiming(side * width, LEAVE, (finished) => {
            if (finished) scheduleOnRN(close);
          }),
        );
        return;
      }
      if (!sideways && (translationY < -SWIPE_DISTANCE / 2 || velocityY < -SWIPE_VELOCITY)) {
        offsetY.set(
          withTiming(-160, LEAVE, (finished) => {
            if (finished) scheduleOnRN(close);
          }),
        );
        return;
      }
      offsetX.set(withSpring(0, { ...SETTLE, velocity: velocityX }));
      offsetY.set(withSpring(0, { ...SETTLE, velocity: velocityY }));
    },
  });
  const swipeStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(Math.abs(offsetX.get()) / width, 0.6),
    transform: [{ translateX: offsetX.get() }, { translateY: offsetY.get() }],
  }));

  const accent = {
    success: theme.desktop.successAccent,
    info: theme.desktop.infoAccent,
    warning: theme.desktop.warningAccent,
    error: theme.desktop.destructiveAccent,
  }[entry.kind];
  return (
    <Animated.View
      {...entering}
      {...(exits ? { exiting: TOAST_EXITING } : {})}
      layout={LinearTransition.duration(220)}
      style={styles.slot}
    >
      <GestureDetector gesture={pan}>
        <Animated.View style={swipeStyle}>
          <Touchable
            feedback="opacity"
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel={
              entry.description ? `${entry.message}. ${entry.description}` : entry.message
            }
            accessibilityHint="Dismisses the message."
            style={styles.toast}
          >
            <View style={[styles.badge, { backgroundColor: withAlpha(accent, 0.12) }]}>
              <Icon name={KIND_ICONS[entry.kind]} size={16} colorValue={accent} />
            </View>
            <View style={styles.body}>
              <Text style={styles.title} numberOfLines={2}>
                {entry.message}
              </Text>
              {entry.description ? (
                <Text style={styles.detail} numberOfLines={3}>
                  {entry.description}
                </Text>
              ) : null}
            </View>
          </Touchable>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

function ToastStack({
  feedback,
  exits = true,
}: {
  feedback: FeedbackStore;
  exits?: boolean;
}): ReactElement | null {
  const messages = useStore(feedback.store, (state) => state.messages);
  const covered = useStore(feedback.store, toastsCoveredBy);
  const startupVisible = useStore(feedback.store, (state) => state.startupVisible);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  useEffect(() => () => feedback.setToastStackHeight(0), [feedback]);
  if (covered) return null;
  const maxHeight = startupVisible
    ? Math.max(0, (height - insets.top - insets.bottom - TOP_BAR_CLEARANCE - 80) * 0.35)
    : undefined;
  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + TOP_BAR_CLEARANCE }]}>
      <ScrollView
        style={[styles.toastScroll, { maxHeight }]}
        contentContainerStyle={styles.toastContent}
        onLayout={(event) => feedback.setToastStackHeight(event.nativeEvent.layout.height)}
        keyboardShouldPersistTaps="handled"
      >
        {/* The feedback store caps ordinary messages at three. */}
        {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
        {messages.map((entry) => (
          <FeedbackToast key={entry.id} entry={entry} feedback={feedback} exits={exits} />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * Short feedback for the user's own actions above all screens, as the desktop toasts: a card with
 * the icon of its kind on a tinted circle, the message, and the details. It shows near the top on
 * both platforms, under the top bar, so it never covers the header controls, the composer, the
 * keyboard, or the tab bar. A tap, or a swipe up or to a side, dismisses it.
 *
 * iOS shows sheets and modals in their own view controllers above the root view. The toasts then
 * render in a window overlay, so they show above an open sheet. The overlay is not modal, so
 * VoiceOver still reaches the screen below. Gesture Handler attaches to the overlay by itself.
 *
 * On Android, a React Native `Modal` is its own window above the root view. While one is open,
 * its `ModalFeedbackHost` shows the toasts.
 */
export function FeedbackHost({ feedback }: { feedback: FeedbackStore }): ReactElement {
  const messages = useStore(feedback.store, (state) => state.messages);
  const inRoot = useStore(feedback.store, (state) => toastWindowOf(state) === null);
  const effects = messages.map((entry) => (
    <FeedbackEffects key={entry.id} entry={entry} dismiss={feedback.dismiss} />
  ));
  if (Platform.OS !== "ios") {
    return (
      <>
        {effects}
        {inRoot ? <ToastStack feedback={feedback} /> : null}
      </>
    );
  }
  return (
    <>
      {effects}
      <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>
        <ToastStack feedback={feedback} />
      </FullWindowOverlay>
    </>
  );
}

function AndroidModalToasts(): ReactElement | null {
  const feedback = useFeedbackStore();
  const id = useId();
  useEffect(() => feedback.openWindow(id), [feedback, id]);
  const shown = useStore(feedback.store, (state) => toastWindowOf(state) === id);
  // A closing modal slides out with its window while the root shows its toasts at once. A toast
  // that faded out in that window read as a second toast, so the toasts of a modal do not fade.
  return shown ? (
    <>
      <ToastStack feedback={feedback} exits={false} />
      <ModalStartupProgressHost />
    </>
  ) : null;
}

/**
 * The toasts of an open React Native `Modal`. Render it last in the gesture root of the modal. On
 * Android, the modal is its own window and covers the root view, so the newest open modal shows
 * the toasts. iOS shows them in a window overlay above every modal, so this renders nothing there.
 */
export function ModalFeedbackHost(): ReactElement | null {
  return Platform.OS === "ios" ? null : <AndroidModalToasts />;
}

/** Hides the toasts while a menu is open, so a toast never covers its first items. */
export function useMenuCoversToasts(open: boolean): void {
  const feedback = useFeedbackStore();
  useEffect(() => (open ? feedback.openMenu() : undefined), [feedback, open]);
}

const styles = StyleSheet.create((theme) => ({
  host: {
    position: "absolute",
    left: theme.space.md,
    right: theme.space.md,
    gap: theme.space.sm,
    alignItems: "center",
  },
  toastScroll: { width: "100%", maxWidth: 520, flexGrow: 0 },
  toastContent: { gap: theme.space.sm, alignItems: "center" },
  slot: { width: "100%", maxWidth: 520 },
  // `border bg-card shadow-xl`, as the desktop toast.
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
    boxShadow: theme.shadows.overlay,
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, gap: 2 },
  title: {
    ...sansWeight("semibold"),
    fontSize: 15,
    lineHeight: 20,
    color: theme.desktop.foreground,
  },
  detail: { fontSize: 13, lineHeight: 18, color: theme.desktop.mutedForeground },
  // The desktop close control: a small outlined circle.
}));
