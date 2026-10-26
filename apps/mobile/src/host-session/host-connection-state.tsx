import { useRouter } from "expo-router";
import { type ReactElement, useCallback } from "react";
import { View, type ViewStyle } from "react-native";
import Animated, { type CSSStyle } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import type { SavedHost } from "@/device-data/device-records";
import { useAppTheme } from "@/theme/app-theme-context";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { calloutColors } from "@/ui/callout-colors";
import { routes } from "@/navigation/routes";
import { Button } from "@/ui/button";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { usePendingAction } from "@/ui/use-pending-action";
import { useShake } from "@/ui/use-shake";
import { useActiveSession, useCommandGate } from "./active-session-context";
import { connectionCopy, retryStatusLabel } from "./connection-phase";
import { useClaimConnectionStatus } from "./connection-status-slot";

/**
 * True while the host cannot answer: the connection dropped, failed, or the device is offline. A
 * screen with nothing to show then shows `HostConnectionState` instead of its read errors.
 */
export const useHostUnavailable = (): boolean => {
  const { phase } = useCommandGate();
  return phase.kind === "reconnecting" || phase.kind === "failed" || phase.kind === "offline";
};

/** A first connection that is fast shows no connection state at all. */
const DELAYED_FADE_IN: CSSStyle<ViewStyle> = {
  animationName: { from: { opacity: 0 }, to: { opacity: 1 } },
  animationDuration: 220,
  animationDelay: 500,
  animationFillMode: "both",
};

const FADE_IN: CSSStyle<ViewStyle> = {
  animationName: { from: { opacity: 0, transform: [{ translateY: 8 }] }, to: { opacity: 1 } },
  animationDuration: 240,
  animationFillMode: "both",
};

/** The host name and its address, without the address twice when the name is the address. */
const hostAddress = (label: string, endpoint: string): { title: string; detail: string | null } => {
  const url = new URL(endpoint);
  const named = label !== url.hostname && label !== url.host;
  return named ? { title: label, detail: url.host } : { title: url.host, detail: null };
};

/**
 * The whole screen while the host is not connected and the screen has nothing to show yet, as
 * the desktop host connection page: what happened, the host, what to check, then Retry
 * connection and Choose another host. A manual retry shows its progress, and a failed retry
 * shakes the card with an error haptic, so every press has a visible result.
 */
export function HostConnectionState(): ReactElement {
  const router = useRouter();
  const theme = useAppTheme();
  const { host, remote } = useActiveSession();
  const { phase } = useCommandGate();
  useClaimConnectionStatus();
  const copy = connectionCopy(phase, host.label);
  const colors = calloutColors(theme, copy.tone);

  const shake = useShake();
  const retry = useCallback(() => remote.remote.retry(), [remote]);
  const attempt = usePendingAction(retry, shake.shake);
  const busy = attempt.pending || copy.busy;

  const statusLabel = retryStatusLabel({
    phase,
    copy,
    retrying: attempt.pending,
    failedAt: attempt.failedAt,
  });

  return (
    <Animated.View style={[styles.root, phase.kind === "connecting" ? DELAYED_FADE_IN : FADE_IN]}>
      <Animated.View style={[styles.card, shake.style]}>
        <View style={styles.header}>
          <View
            style={[
              styles.stateIcon,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            {busy ? (
              <LoaderSpinner size={18} color={colors.muted} />
            ) : (
              <Icon
                name={phase.kind === "offline" ? "wifi-off" : "cloud-off"}
                size={18}
                colorValue={colors.muted}
              />
            )}
          </View>
          <Text variant="title2" accessibilityRole="header" style={styles.title}>
            {copy.title}
          </Text>
          <HostLine shell={host.shell} label={host.label} endpoint={host.endpoint} />
        </View>

        <View style={styles.body}>
          {copy.message ? (
            <Text variant="subhead" tone="tertiary" selectable>
              {copy.message}
            </Text>
          ) : null}
          <View style={styles.status} accessibilityLiveRegion="polite">
            {busy ? (
              <LoaderSpinner size={13} color={theme.desktop.mutedForeground} />
            ) : (
              <View style={[styles.dot, { backgroundColor: colors.muted }]} />
            )}
            <Text variant="subhead" tone="secondary" style={styles.shrink}>
              {statusLabel}
            </Text>
          </View>
          {copy.checks.length > 0 ? <ConnectionChecks checks={copy.checks} /> : null}
        </View>

        <View style={styles.footer}>
          {copy.canRetry ? (
            <Button
              label={attempt.pending ? "Retrying…" : "Retry connection"}
              icon={attempt.pending ? undefined : "refresh"}
              size="lg"
              fill
              loading={attempt.pending}
              onPress={attempt.run}
            />
          ) : null}
          <Button
            label="Choose another host"
            variant="outline"
            size="lg"
            fill
            onPress={() => router.push(routes.hosts())}
          />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

/** The host kind, its name, and its address when the name is not the address. */
function HostLine({
  shell,
  label,
  endpoint,
}: {
  shell: SavedHost["shell"];
  label: string;
  endpoint: string;
}): ReactElement {
  const address = hostAddress(label, endpoint);
  return (
    <View style={styles.host}>
      <Icon name={shell === "electron" ? "laptop" : "server"} size={16} color="tertiaryLabel" />
      <Text weight="medium" numberOfLines={1} style={styles.shrink} selectable>
        {address.title}
      </Text>
      {address.detail ? (
        <Text
          variant="monoSmall"
          tone="tertiary"
          numberOfLines={1}
          style={styles.shrink}
          selectable
        >
          {address.detail}
        </Text>
      ) : null}
    </View>
  );
}

/** The numbered things to check on the host and the device. */
function ConnectionChecks({ checks }: { checks: readonly string[] }): ReactElement {
  return (
    <View style={styles.checks}>
      <Text variant="footnote" weight="medium" tone="tertiary">
        Check that
      </Text>
      {checks.map((check, index) => (
        <View key={check} style={styles.check}>
          <View style={styles.step}>
            <Text variant="caption2" tabular>
              {index + 1}
            </Text>
          </View>
          <Text variant="subhead" style={styles.shrink}>
            {check}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    justifyContent: "center",
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    paddingHorizontal: theme.layout.screenPadding,
    paddingBottom: theme.space.huge,
  },
  card: {
    borderWidth: 1,
    borderColor: theme.desktop.border,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    backgroundColor: theme.desktop.card,
    boxShadow: theme.shadows.card,
  },
  header: { gap: theme.space.md, paddingHorizontal: theme.space.xl, paddingTop: theme.space.xxl },
  stateIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { letterSpacing: -0.4 },
  host: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  shrink: { flexShrink: 1 },
  body: { gap: theme.space.lg, padding: theme.space.xl },
  status: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, minHeight: 20 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  checks: {
    gap: 10,
    padding: theme.space.md,
    borderWidth: 1,
    borderColor: theme.desktop.border,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    backgroundColor: theme.colors.panelFill,
  },
  check: { flexDirection: "row", alignItems: "center", gap: theme.space.md },
  step: {
    width: 22,
    height: 22,
    borderRadius: theme.radius.sm,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    gap: theme.space.sm,
    paddingHorizontal: theme.space.xl,
    paddingVertical: theme.space.lg,
    borderTopWidth: 1,
    borderTopColor: theme.desktop.border,
  },
}));
