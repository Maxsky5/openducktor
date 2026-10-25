import { memo, type ReactElement, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { useCommandBlocked } from "@/host-session/active-session-context";
import { touchSlop } from "@/theme/tokens";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";

/**
 * The controls of the desktop composer card. The visual controls keep the desktop sizes, 28 and
 * 32 points, and their touch areas grow to the platform minimum.
 */

/**
 * A quiet icon control, as the desktop attach button: a muted 14-point icon in a 28-point square
 * with large corners.
 */
export const QuietIconControl = memo(function QuietIconControl({
  icon,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
  command = false,
  onPress,
}: {
  icon: IconName;
  accessibilityLabel: string;
  accessibilityHint?: string | undefined;
  disabled?: boolean | undefined;
  command?: boolean | undefined;
  onPress: () => void;
}): ReactElement {
  const theme = useAppTheme();
  const blocked = useCommandBlocked(command, accessibilityLabel);
  const inactive = disabled || blocked;
  return (
    <Touchable
      feedback="opacity"
      onPress={onPress}
      disabled={inactive}
      hitSlop={touchSlop(28)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive }}
      style={styles.quietIcon}
    >
      <Icon name={icon} size={14} colorValue={theme.desktop.mutedForeground} />
    </Touchable>
  );
});

/**
 * A quiet selector, as the desktop model, agent, and effort triggers: a leading mark, a 12-point
 * muted label that truncates, and the up and down chevrons.
 */
export const QuietSelector = memo(function QuietSelector({
  leading,
  label,
  detail,
  accessibilityLabel,
  accessibilityHint,
  disabled,
  onPress,
  fixed = false,
}: {
  leading: ReactNode;
  label: string;
  /** A short value after the label, such as the effort, that stays whole while the label shrinks. */
  detail?: string | null | undefined;
  accessibilityLabel: string;
  accessibilityHint: string;
  disabled: boolean;
  onPress: () => void;
  /** True for a short value, such as the effort, that keeps its width while others shrink. */
  fixed?: boolean | undefined;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <Touchable
      feedback="opacity"
      onPress={onPress}
      disabled={disabled}
      hitSlop={touchSlop(28)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      containerStyle={fixed ? styles.selectorFixed : styles.selectorArea}
      style={styles.selector}
    >
      {leading}
      <Text variant="footnote" numberOfLines={1} style={styles.selectorLabel}>
        {label}
      </Text>
      {detail ? (
        <Text variant="footnote" numberOfLines={1} style={styles.selectorDetail}>
          {`· ${detail}`}
        </Text>
      ) : null}
      <Icon name="chevron-up-down" size={14} colorValue={theme.desktop.mutedForeground} />
    </Touchable>
  );
});

/**
 * The desktop Send button: a violet 32-point square, dimmed while it is closed, with a turning
 * loader while a send prepares. A count of the review comments that go with the message
 * sits on its corner.
 */
export const SendButton = memo(function SendButton({
  enabled,
  busy,
  label,
  hint,
  pendingCount,
  pendingLabel,
  onPress,
}: {
  enabled: boolean;
  busy: boolean;
  label: string;
  hint: string | null;
  /** The review comments that go with the next message. */
  pendingCount: number;
  pendingLabel: string | null;
  onPress: () => void;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <View>
      <Touchable
        feedback="scale"
        onPress={onPress}
        disabled={!enabled || busy}
        dimWhenDisabled={!busy}
        radius={theme.radius.lg}
        hitSlop={touchSlop(32)}
        accessibilityRole="button"
        accessibilityLabel={busy ? "Preparing message" : label}
        accessibilityHint={hint ?? undefined}
        accessibilityState={{ disabled: !enabled || busy, busy }}
        style={[styles.square, styles.send]}
      >
        {busy ? (
          <LoaderSpinner size={14} color={theme.desktop.primaryForeground} />
        ) : (
          <Icon name="send-horizontal" size={14} colorValue={theme.desktop.primaryForeground} />
        )}
      </Touchable>
      {pendingCount > 0 ? (
        <View
          style={styles.badge}
          accessible
          accessibilityRole="text"
          accessibilityLabel={pendingLabel ?? undefined}
        >
          <Text variant="caption2" tabular style={styles.badgeText}>
            {pendingCount}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

/**
 * The desktop Stop button: a red 32-point square with a filled square. Stop is a host command, so
 * it waits for a live host connection. It shows a turning loader while the stop runs.
 */
export const StopButton = memo(function StopButton({
  stopping,
  connected,
  onStop,
}: {
  stopping: boolean;
  connected: boolean;
  onStop: () => void;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <Touchable
      feedback="scale"
      onPress={onStop}
      disabled={stopping || !connected}
      dimWhenDisabled={!stopping}
      radius={theme.radius.lg}
      hitSlop={touchSlop(32)}
      accessibilityRole="button"
      accessibilityLabel="Stop session"
      accessibilityHint={connected ? undefined : "Available when the host connection is live."}
      accessibilityState={{ busy: stopping, disabled: stopping || !connected }}
      style={[styles.square, styles.stop]}
    >
      {stopping ? (
        <LoaderSpinner size={14} color={theme.desktop.destructiveForeground} />
      ) : (
        <View style={styles.stopSquare} />
      )}
    </Touchable>
  );
});

/**
 * A quiet 32-point icon square, as the desktop ghost icon buttons next to Send, such as Steer or
 * Queue while a turn runs, or Remove in the queued message editor.
 */
export const GhostIconButton = memo(function GhostIconButton({
  icon,
  accessibilityLabel,
  disabled,
  command = false,
  onPress,
}: {
  icon: IconName;
  accessibilityLabel: string;
  disabled: boolean;
  command?: boolean | undefined;
  onPress: () => void;
}): ReactElement {
  const theme = useAppTheme();
  const blocked = useCommandBlocked(command, accessibilityLabel);
  const inactive = disabled || blocked;
  return (
    <Touchable
      feedback="opacity"
      onPress={onPress}
      disabled={inactive}
      hitSlop={touchSlop(32)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: inactive }}
      style={styles.square}
    >
      <Icon name={icon} size={14} colorValue={theme.desktop.mutedForeground} />
    </Touchable>
  );
});

/**
 * A desktop `sm` text button, 32 points high, which grows with the system text size: `ghost` for
 * Cancel, `primary` for Save, `outline` for Resume.
 */
export const ComposerTextButton = memo(function ComposerTextButton({
  label,
  icon,
  variant,
  busy = false,
  disabled = false,
  command = false,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  icon?: IconName | undefined;
  variant: "ghost" | "primary" | "outline";
  busy?: boolean | undefined;
  disabled?: boolean | undefined;
  command?: boolean | undefined;
  accessibilityLabel?: string | undefined;
  onPress: () => void;
}): ReactElement {
  const theme = useAppTheme();
  const blocked = useCommandBlocked(command, label);
  const inactive = disabled || busy || blocked;
  styles.useVariants({ button: variant });
  const color = variant === "primary" ? theme.desktop.primaryForeground : theme.desktop.foreground;
  return (
    <Touchable
      feedback="scale"
      onPress={onPress}
      disabled={inactive}
      dimWhenDisabled={!busy}
      radius={theme.radius.lg}
      hitSlop={touchSlop(32)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy }}
      style={styles.textButton}
    >
      {busy ? (
        <LoaderSpinner size={14} color={color} />
      ) : icon ? (
        <Icon name={icon} size={14} colorValue={color} />
      ) : null}
      <Text variant="footnote" weight="medium" style={{ color }}>
        {label}
      </Text>
    </Touchable>
  );
});

const styles = StyleSheet.create((theme) => ({
  quietIcon: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
  },
  selectorArea: { flexShrink: 1, minWidth: 0 },
  selectorFixed: { flexShrink: 0 },
  // The controls that hold text keep their desktop height as a minimum, so they grow with the
  // system text size.
  selector: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 28,
    paddingHorizontal: theme.space.sm,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
  },
  selectorLabel: { flexShrink: 1, color: theme.desktop.mutedForeground },
  selectorDetail: { flexShrink: 0, color: theme.desktop.mutedForeground },
  square: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
  },
  send: { backgroundColor: theme.desktop.primary, boxShadow: theme.shadows.card },
  stop: { backgroundColor: theme.desktop.destructive },
  stopSquare: {
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: theme.desktop.destructiveForeground,
  },
  // The desktop count: `bg-amber-300 text-neutral-950 ring-2 ring-card`.
  badge: {
    position: "absolute",
    top: -8,
    right: -8,
    minWidth: 20,
    minHeight: 20,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.pill,
    borderWidth: 2,
    borderColor: theme.desktop.card,
    backgroundColor: theme.palette.amber300,
  },
  badgeText: { fontSize: 10, lineHeight: 12, color: theme.palette.slate950 },
  textButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 32,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    variants: {
      button: {
        ghost: {},
        primary: { backgroundColor: theme.desktop.primary, boxShadow: theme.shadows.card },
        outline: {
          borderWidth: 1,
          borderColor: theme.desktop.input,
          backgroundColor: theme.desktop.card,
        },
      },
    },
  },
}));
