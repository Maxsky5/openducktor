import type { ReactElement, ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import Animated from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { type Tone, DELAYED_FADE_IN } from "@/theme/tokens";
import { Button } from "./button";
import { haptics } from "./haptics";
import { Icon, type IconName } from "./icon";
import { Text } from "./text";
import { toneColors } from "./tones";
import { useAnnounce } from "./use-announce";
import { usePendingAction } from "./use-pending-action";

export function LoadingState({ label }: { label: string }): ReactElement {
  const theme = useAppTheme();
  return (
    <Animated.View
      style={[styles.center, DELAYED_FADE_IN]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      <ActivityIndicator color={theme.colors.tint} />
      <Text variant="subhead" tone="tertiary">
        {label}
      </Text>
    </Animated.View>
  );
}

/** An icon in a soft rounded tile, as the desktop empty states. */
function StateIcon({ icon, tone }: { icon: IconName; tone: Tone }): ReactElement {
  const theme = useAppTheme();
  const colors = toneColors(theme, tone);
  return (
    <View
      style={[styles.iconTile, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Icon
        name={icon}
        size={26}
        colorValue={tone === "neutral" ? theme.colors.tertiaryLabel : colors.text}
      />
    </View>
  );
}

export function EmptyState({
  title,
  message,
  icon = "inbox",
  action,
}: {
  title: string;
  message?: string | undefined;
  icon?: IconName | undefined;
  action?: ReactNode;
}): ReactElement {
  return (
    <View style={styles.center}>
      <StateIcon icon={icon} tone="neutral" />
      <View style={styles.copy}>
        <Text variant="title3" style={styles.centerText}>
          {title}
        </Text>
        {message ? (
          <Text variant="callout" tone="tertiary" style={styles.centerText}>
            {message}
          </Text>
        ) : null}
      </View>
      {action ? <View style={styles.actions}>{action}</View> : null}
    </View>
  );
}

/**
 * Shows the reason and the next action. `onRetry` appears only when the read or action is safe to
 * repeat; a command with an unknown outcome never offers it.
 */
export function ErrorState({
  title,
  message,
  onRetry,
  retryLabel = "Try Again",
  action,
}: {
  title: string;
  message: string;
  /** A retry that returns a promise shows its progress on the button until it settles. */
  onRetry?: (() => void) | (() => Promise<void>) | undefined;
  retryLabel?: string;
  action?: ReactNode;
}): ReactElement {
  const retry = usePendingAction(async () => {
    await onRetry?.();
  }, haptics.error);
  useAnnounce(`${title}. ${message}`);
  return (
    <View style={styles.center} accessibilityLiveRegion="polite">
      <StateIcon icon="triangle-alert" tone="warning" />
      <View style={styles.copy}>
        <Text variant="title3" style={styles.centerText}>
          {title}
        </Text>
        <Text variant="callout" tone="tertiary" style={styles.centerText} selectable>
          {message}
        </Text>
      </View>
      <View style={styles.actions}>
        {onRetry ? (
          <Button
            label={retryLabel}
            variant="outline"
            icon="refresh"
            loading={retry.pending}
            onPress={retry.run}
          />
        ) : null}
        {action}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.lg,
    paddingHorizontal: theme.space.xxxl,
    paddingVertical: theme.space.huge,
  },
  iconTile: {
    width: 56,
    height: 56,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { alignItems: "center", gap: theme.space.xs },
  centerText: { textAlign: "center", maxWidth: 340 },
  actions: {
    flexDirection: "row",
    gap: theme.space.sm,
    flexWrap: "wrap",
    justifyContent: "center",
    paddingTop: theme.space.xs,
  },
}));
