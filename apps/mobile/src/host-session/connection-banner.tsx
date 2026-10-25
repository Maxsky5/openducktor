import { type ReactElement, useCallback } from "react";
import { View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { calloutColors } from "@/ui/callout-colors";
import { Button } from "@/ui/button";
import { haptics } from "@/ui/haptics";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { usePendingAction } from "@/ui/use-pending-action";
import { useShownAfter } from "@/ui/use-shown-after";
import { useActiveSession, useCommandGate } from "./active-session-context";
import { connectionCopy } from "./connection-phase";

const ENTER = FadeIn.duration(200);
const EXIT = FadeOut.duration(160);

/** A state that the app works on by itself, such as a reconnect after unlock, shows after this. */
const BUSY_DELAY_MS = 800;

/**
 * One status line above a screen that shows its last content while the host is not connected,
 * in the colors of a desktop notice. Host command controls stay disabled through the command
 * gate. A screen with nothing to show uses `HostConnectionState` instead, so the status shows once.
 */
export function ConnectionBanner(): ReactElement | null {
  const theme = useAppTheme();
  const { phase } = useCommandGate();
  const { host, remote } = useActiveSession();
  const retry = useCallback(() => remote.remote.retry(), [remote]);
  const attempt = usePendingAction(retry, haptics.error);
  const copy = phase.kind === "connected" ? null : connectionCopy(phase, host.label);
  const shown = useShownAfter(copy !== null, copy?.busy ? BUSY_DELAY_MS : 0);
  if (!copy || !shown) return null;
  const colors = calloutColors(theme, copy.tone);
  const busy = copy.busy || attempt.pending;
  return (
    <Animated.View
      entering={ENTER}
      exiting={EXIT}
      style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityRole="alert"
      accessibilityLabel={copy.message ? `${copy.status}. ${copy.message}` : copy.status}
    >
      {busy ? (
        <LoaderSpinner size={16} color={colors.muted} />
      ) : (
        <Icon
          name={phase.kind === "offline" ? "wifi-off" : "cloud-off"}
          size={16}
          colorValue={colors.muted}
        />
      )}
      <View style={styles.text}>
        <Text variant="subhead" weight="medium" numberOfLines={1} style={{ color: colors.text }}>
          {attempt.pending ? "Retrying…" : copy.status}
        </Text>
        <Text variant="footnote" numberOfLines={2} style={{ color: colors.muted }}>
          {busy ? host.label : "Showing saved content. Actions are paused."}
        </Text>
      </View>
      {copy.canRetry ? (
        <Button
          label="Retry"
          variant="outline"
          size="sm"
          disabled={attempt.pending}
          onPress={attempt.run}
          accessibilityLabel="Retry the connection now"
        />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    marginHorizontal: theme.layout.screenPadding,
    marginTop: theme.space.xs,
    marginBottom: theme.space.sm,
    paddingLeft: theme.space.md,
    paddingRight: 10,
    paddingVertical: 10,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
  },
  text: { flex: 1, minWidth: 0, gap: 1 },
}));
