import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { useStartupAttempts } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import {
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Platform, ScrollView, useWindowDimensions, View } from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  LayoutAnimationConfig,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";
import { StyleSheet } from "react-native-unistyles";
import { useStore } from "zustand";
import { useFeedbackStore } from "@/app-shell/app-services";
import { appStateVisibility } from "@/composition/app-visibility";
import { startupCoveredBy, toastWindowOf } from "@/feedback/feedback-store";
import { useStartupPresentation } from "./startup-presentation-context";
import { StartupTrace } from "./startup-trace";
import { useAppTheme } from "@/theme/app-theme-context";
import { motion } from "@/theme/tokens";

const CARD_ENTERING = FadeInDown.duration(motion.base)
  .easing(motion.easeOutCurve)
  .withInitialValues({ transform: [{ translateY: 8 }] })
  .reduceMotion(ReduceMotion.System);
const CARD_ENTERING_REDUCED = FadeIn.duration(motion.fast)
  .easing(motion.easeOutCurve)
  .reduceMotion(ReduceMotion.Never);
const CARD_EXITING = FadeOut.duration(motion.fast)
  .easing(motion.easeOutCurve)
  .reduceMotion(ReduceMotion.Never);
const CARD_RESIZE = {
  duration: motion.base,
  easing: motion.easeOutCurve,
  reduceMotion: ReduceMotion.System,
};

/** Startup feedback has its own retention and count, while it shares native window placement. */
export function StartupProgressHost(): ReactElement | null {
  const feedback = useFeedbackStore();
  const attempts = useStartupAttempts();
  const startupVisible = attempts.some((attempt) => attempt.presentation === "notification");
  useEffect(() => {
    feedback.setStartupVisible(startupVisible);
    return () => feedback.setStartupVisible(false);
  }, [feedback, startupVisible]);
  const inRoot = useStore(feedback.store, (state) => toastWindowOf(state) === null);
  if (Platform.OS === "ios")
    return (
      <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>
        <StartupStack />
      </FullWindowOverlay>
    );
  return inRoot ? <StartupStack /> : null;
}

function StartupStack(): ReactElement | null {
  // Keep the viewport open while the last native card finishes its exit. The layout callbacks keep
  // the sizes with no render, and the stack holds them only when it empties.
  const measured = useRef({ viewport: 0, content: 0 });
  const [heldSize, setHeldSize] = useState<{ viewport: number; content: number } | null>(null);
  const attempts = useStartupAttempts();
  const { startupAttempts } = useClientConnection();
  const hidden = useSyncExternalStore(
    appStateVisibility.subscribe,
    appStateVisibility.isHidden,
    appStateVisibility.isHidden,
  );
  const feedback = useFeedbackStore();
  const covered = useStore(feedback.store, startupCoveredBy);
  const toastStackHeight = useStore(feedback.store, (state) => state.toastStackHeight);
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  useEffect(() => {
    if (!hidden) startupAttempts.expireSuccess();
  }, [hidden, startupAttempts]);
  const visible = attempts.filter((attempt) => attempt.presentation === "notification");
  const empty = visible.length === 0;
  useLayoutEffect(() => {
    setHeldSize(empty ? { ...measured.current } : null);
  }, [empty]);
  if (hidden || covered) return null;
  const top = insets.top + 70 + toastStackHeight + (toastStackHeight > 0 ? theme.space.sm : 0);
  const bottom = insets.bottom + 80;
  const maxHeight = Math.max(0, height - top - bottom);
  return (
    <LayoutAnimationConfig skipExiting>
      <View
        collapsable={false}
        pointerEvents={empty ? "none" : "box-none"}
        style={[
          styles.host,
          {
            bottom,
            maxHeight,
          },
        ]}
      >
        <ScrollView
          style={[styles.stack, empty && { height: heldSize?.viewport ?? 0 }]}
          contentContainerStyle={[styles.content, empty && { minHeight: heldSize?.content ?? 0 }]}
          onLayout={(event) => {
            if (!empty) measured.current.viewport = event.nativeEvent.layout.height;
          }}
          onContentSizeChange={(_width, contentHeight) => {
            if (!empty) measured.current.content = contentHeight;
          }}
          nestedScrollEnabled
          bounces={false}
          alwaysBounceVertical={false}
          overScrollMode="never"
          keyboardShouldPersistTaps="handled"
        >
          {/* Keep native output pages attached while the user's manual starts update card heights. */}
          {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
          {visible.map((attempt) => (
            <StartupCard
              key={attempt.id}
              attemptId={attempt.id}
              detailsMaxHeight={maxHeight * 0.45}
            />
          ))}
        </ScrollView>
      </View>
    </LayoutAnimationConfig>
  );
}

function StartupCard({
  attemptId,
  detailsMaxHeight,
}: {
  attemptId: string;
  detailsMaxHeight: number;
}): ReactElement {
  const { notificationPresented } = useStartupPresentation();
  const reducedMotion = useReducedMotion();
  const [firstPresentation] = useState(() => !notificationPresented.has(attemptId));
  useEffect(() => {
    notificationPresented.add(attemptId);
  }, [attemptId, notificationPresented]);
  // The stack grows from the bottom of the screen. The card animates its own height, so the views
  // above it follow each frame and the card bottom stays in place.
  const height = useSharedValue<number | null>(null);
  // The first layout sets the height at once. The JavaScript thread does not read the shared value.
  const hasHeight = useRef(false);
  const resizeStyle = useAnimatedStyle(() => {
    const value = height.get();
    return value === null ? {} : { height: value };
  });
  const entering = reducedMotion ? CARD_ENTERING_REDUCED : CARD_ENTERING;
  return (
    <Animated.View
      {...(firstPresentation ? { entering } : {})}
      exiting={CARD_EXITING}
      style={styles.card}
    >
      <Animated.View style={[styles.resize, resizeStyle]}>
        <View
          onLayout={(event) => {
            const next = event.nativeEvent.layout.height;
            height.set(hasHeight.current ? withTiming(next, CARD_RESIZE) : next);
            hasHeight.current = true;
          }}
        >
          <StartupTrace
            attemptId={attemptId}
            presentation="notification"
            detailsMaxHeight={detailsMaxHeight}
          />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  host: { position: "absolute", left: theme.space.md, right: theme.space.md, alignItems: "center" },
  stack: { width: "100%", maxWidth: 520, flexGrow: 0, flexShrink: 1 },
  content: { gap: theme.space.sm },
  resize: { overflow: "hidden" },
  card: {
    overflow: "hidden",
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
    boxShadow: theme.shadows.overlay,
  },
}));
