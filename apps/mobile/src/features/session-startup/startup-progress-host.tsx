import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { useStartupAttempts } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { type ReactElement, use, useEffect, useSyncExternalStore } from "react";
import { Platform, ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";
import { StyleSheet } from "react-native-unistyles";
import { useStore } from "zustand";
import { useFeedbackStore } from "@/app-shell/app-services";
import { appStateVisibility } from "@/composition/app-visibility";
import { toastsCoveredBy, toastWindowOf } from "@/feedback/feedback-store";
import { StartupPresentationContext } from "./startup-presentation-context";
import { StartupTrace } from "./startup-trace";
import { useAppTheme } from "@/theme/app-theme-context";

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

/** The newest Android modal owns progress while its separate window covers the route tree. */
export function ModalStartupProgressHost(): ReactElement | null {
  const presentation = use(StartupPresentationContext);
  return presentation ? <StartupStack /> : null;
}

function StartupStack(): ReactElement | null {
  const attempts = useStartupAttempts();
  const { startupAttempts } = useClientConnection();
  const hidden = useSyncExternalStore(
    appStateVisibility.subscribe,
    appStateVisibility.isHidden,
    appStateVisibility.isHidden,
  );
  const feedback = useFeedbackStore();
  const covered = useStore(feedback.store, toastsCoveredBy);
  const toastStackHeight = useStore(feedback.store, (state) => state.toastStackHeight);
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  useEffect(() => {
    if (!hidden) startupAttempts.expireSuccess();
  }, [hidden, startupAttempts]);
  const visible = attempts.filter((attempt) => attempt.presentation === "notification");
  if (hidden || covered || visible.length === 0) return null;
  const top = insets.top + 70 + toastStackHeight + (toastStackHeight > 0 ? theme.space.sm : 0);
  const bottom = insets.bottom + 80;
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.host,
        {
          bottom,
          maxHeight: Math.max(0, height - top - bottom),
        },
      ]}
    >
      <ScrollView
        style={styles.stack}
        contentContainerStyle={styles.content}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        {/* Keep native output pages attached while the user's manual starts update card heights. */}
        {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
        {visible.map((attempt) => (
          <View key={attempt.id} style={styles.card}>
            <StartupTrace attemptId={attempt.id} presentation="notification" />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  host: { position: "absolute", left: theme.space.md, right: theme.space.md, alignItems: "center" },
  stack: { width: "100%", maxWidth: 520, flexGrow: 0, flexShrink: 1 },
  content: { gap: theme.space.sm },
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
