import type { PullRequestReviewState } from "@openducktor/contracts";
import type { TaskExecutionCiPanelStateKind } from "@openducktor/frontend-core/review/task-execution-ci-panel-copy";
import { memo, type ReactElement } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Button } from "@/ui/button";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { useAnnounce } from "@/ui/use-announce";
import {
  type CiBadgeVariant,
  ciBadgeColors,
  PULL_REQUEST_STATE_PRESENTATION,
  pullRequestStateColor,
} from "./checks-presentation";

/**
 * The desktop badge: a capsule with a status wash and its text. `small` is the 10-point badge of
 * the comment headers.
 */
export const CiBadge = memo(function CiBadge({
  label,
  variant,
  small = false,
  accessibilityLabel,
}: {
  label: string;
  variant: CiBadgeVariant;
  small?: boolean | undefined;
  accessibilityLabel?: string | undefined;
}): ReactElement {
  const theme = useAppTheme();
  const colors = ciBadgeColors(theme, variant);
  styles.useVariants({ small });
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? label}
      style={[styles.badge, { backgroundColor: colors.background, borderColor: colors.border }]}
    >
      <Text numberOfLines={1} style={[styles.badgeText, { color: colors.text }]}>
        {label}
      </Text>
    </View>
  );
});

const STATE_ICONS = {
  empty: "git-pull-request",
  error: "circle-alert",
  loading: "loader-circle",
  unavailable: "circle-slash",
} as const satisfies Record<TaskExecutionCiPanelStateKind, IconName>;

/** The action of a panel state, such as Retry, with its label while it runs. */
export type ChecksStateAction = {
  label: string;
  pendingLabel: string;
  pending: boolean;
  onPress: () => void;
};

/**
 * A CI Checks view without a loaded pull request, as `task-execution-ci-panel-state`: an icon
 * tile, the title, the reason, the provider detail, and an optional action.
 */
export function ChecksPanelState({
  kind,
  title,
  message,
  detail,
  action,
}: {
  kind: TaskExecutionCiPanelStateKind;
  title: string;
  message: string;
  detail?: string | undefined;
  action?: ChecksStateAction | undefined;
}): ReactElement {
  const theme = useAppTheme();
  styles.useVariants({ error: kind === "error" });
  useAnnounce(kind === "error" ? `${title}. ${detail ?? message}` : null);
  return (
    <View
      style={styles.state}
      accessibilityLiveRegion="polite"
      accessibilityRole={kind === "loading" ? "progressbar" : undefined}
    >
      <View style={styles.stateBody}>
        <View style={styles.stateIcon}>
          {kind === "loading" ? (
            <ActivityIndicator color={theme.desktop.mutedForeground} />
          ) : (
            <Icon
              name={STATE_ICONS[kind]}
              size={20}
              colorValue={
                kind === "error" ? theme.desktop.destructive : theme.desktop.mutedForeground
              }
            />
          )}
        </View>
        <Text variant="headline" style={styles.stateTitle}>
          {title}
        </Text>
        <Text variant="callout" style={styles.stateMessage}>
          {message}
        </Text>
        {detail ? (
          <ScrollView style={styles.detail} contentContainerStyle={styles.detailContent}>
            <Text variant="monoSmall" selectable style={styles.detailText}>
              {detail}
            </Text>
          </ScrollView>
        ) : null}
        {action ? (
          <Button
            label={action.pending ? action.pendingLabel : action.label}
            icon="refresh"
            variant="outline"
            size="sm"
            command
            loading={action.pending}
            onPress={action.onPress}
            style={styles.stateAction}
          />
        ) : null}
      </View>
    </View>
  );
}

/**
 * The desktop pull request link: the status icon in its color, "PR #42", and an open mark. It
 * opens the pull request in the device browser.
 */
export function PullRequestChip({
  state,
  number,
  onPress,
}: {
  state: PullRequestReviewState;
  number: number;
  onPress: () => void;
}): ReactElement {
  const theme = useAppTheme();
  const presentation = PULL_REQUEST_STATE_PRESENTATION[state];
  return (
    <Touchable
      feedback="scale"
      onPress={onPress}
      radius={999}
      hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
      accessibilityRole="link"
      accessibilityLabel={`Pull request ${number}, ${presentation.label}`}
      accessibilityHint="Opens the pull request in the device browser."
      style={styles.chip}
    >
      <Icon name={presentation.icon} size={14} colorValue={pullRequestStateColor(theme, state)} />
      <Text variant="caption2" style={styles.chipText}>{`PR #${number}`}</Text>
      <Icon name="external-link" size={12} colorValue={theme.desktop.mutedForeground} />
    </Touchable>
  );
}

const styles = StyleSheet.create((theme) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    variants: {
      small: {
        true: { paddingHorizontal: 7, minHeight: 18 },
        false: { paddingHorizontal: 10, minHeight: 22 },
      },
    },
  },
  badgeText: {
    ...theme.type.caption1,
    variants: {
      small: {
        true: { fontSize: 11, lineHeight: 14 },
        false: {},
      },
    },
  },
  state: { flex: 1, paddingHorizontal: 20, paddingVertical: theme.space.xxl },
  stateBody: {
    flex: 1,
    width: "100%",
    maxWidth: 384,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
  },
  stateIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.sm,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    variants: {
      error: {
        true: { backgroundColor: theme.colors.destructiveWash },
        false: { backgroundColor: theme.desktop.muted },
      },
    },
  },
  stateTitle: { marginTop: theme.space.md, textAlign: "center", color: theme.desktop.foreground },
  stateMessage: {
    marginTop: theme.space.xs,
    textAlign: "center",
    lineHeight: 22,
    color: theme.desktop.mutedForeground,
  },
  detail: {
    marginTop: theme.space.md,
    maxHeight: 128,
    alignSelf: "stretch",
    borderRadius: theme.radius.sm,
    borderCurve: "continuous",
    backgroundColor: theme.desktop.muted,
  },
  detailContent: { paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm },
  detailText: { lineHeight: 20, color: theme.desktop.mutedForeground },
  stateAction: { marginTop: theme.space.lg },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    minHeight: 26,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
  chipText: { color: theme.desktop.mutedForeground },
}));
