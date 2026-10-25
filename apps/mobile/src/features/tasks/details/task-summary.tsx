import type { TaskCard } from "@openducktor/contracts";
import { isQaRejectedTask } from "@openducktor/frontend-core/lib/task-qa";
import { TASK_PULL_REQUEST_ACTION_LABELS } from "@openducktor/frontend-core/tasks/pull-requests/pull-request-presentation";
import { toDisplayTaskLabels } from "@openducktor/frontend-core/tasks/presentation/task-labels";
import { memo, type ReactElement, type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useCommandGate } from "@/host-session/active-session-context";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import {
  IssueTypeBadge,
  PriorityBadge,
  PullRequestBadge,
  QaRejectedBadge,
  SourceIssueBadge,
  TaskLabelChip,
} from "../presentation/task-badges";
import { TaskChip } from "../presentation/task-chip";
import { TaskStatusBadge } from "../presentation/task-status-badge";
import { useCopyTaskId } from "../presentation/use-copy-task-id";

/** The pull request controls of the header, as the desktop Detect PR and Unlink PR buttons. */
export type SummaryPullRequestActions = {
  showDetect: boolean;
  /** Why Detect PR cannot run, shown under it in the destructive color. */
  detectDisabledReason: string | null;
  detecting: boolean;
  onDetect: () => void;
  showUnlink: boolean;
  unlinking: boolean;
  onUnlink: () => void;
  /** False while the task belongs to another workspace than the selected one. */
  enabled: boolean;
};

/** A desktop ghost button: muted text and icon, no frame. It sends a host command, so it follows the command gate. */
function GhostAction({
  label,
  icon,
  busy,
  disabled,
  onPress,
  accessibilityHint,
}: {
  label: string;
  icon: IconName;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
  accessibilityHint?: string | undefined;
}): ReactElement {
  const theme = useAppTheme();
  const gate = useCommandGate();
  return (
    <Touchable
      feedback="opacity"
      onPress={onPress}
      disabled={disabled || busy || !gate.open}
      hitSlop={{ top: 8, bottom: 8 }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={
        gate.open ? accessibilityHint : "Available when the host connection is live."
      }
      accessibilityState={{ busy }}
      style={styles.ghost}
    >
      {busy ? (
        <ActivityIndicator size="small" color={theme.desktop.mutedForeground} />
      ) : (
        <Icon name={icon} size={14} colorValue={theme.desktop.mutedForeground} />
      )}
      <Text variant="footnote" weight="semibold" style={styles.ghostLabel}>
        {label}
      </Text>
    </Touchable>
  );
}

/**
 * The identity of a task at the top of its details, as the desktop details header: the title with
 * the sparkles mark, the ID with its copy control, the status, the type, priority, pull request,
 * source issue, QA, and AI QA badges, the pull request controls, and the labels. `accessory`
 * holds the actions menu where no navigation bar shows it.
 */
export const TaskSummary = memo(function TaskSummary({
  task,
  pullRequest,
  accessory,
  children,
}: {
  task: TaskCard;
  pullRequest: SummaryPullRequestActions;
  accessory?: ReactNode;
  /** The workflow rail and the actions under the header. */
  children?: ReactNode;
}): ReactElement {
  const theme = useAppTheme();
  const copyTaskId = useCopyTaskId();
  const labels = toDisplayTaskLabels(task.labels);
  return (
    <View style={styles.root}>
      <View style={styles.titleRow}>
        <View style={styles.mark}>
          <Icon name="sparkles" size={18} colorValue={theme.colors.tint} />
        </View>
        <Text variant="title2" selectable accessibilityRole="header" style={styles.title}>
          {task.title}
        </Text>
        {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
      </View>
      <View style={styles.idRow}>
        <Touchable
          feedback="opacity"
          onPress={() => copyTaskId(task.id)}
          hitSlop={{ top: 10, bottom: 10, left: 4, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Task ID ${task.id}`}
          accessibilityHint="Copies the task ID."
          style={styles.id}
        >
          <Text variant="monoSmall" numberOfLines={1} style={styles.idText}>
            {task.id}
          </Text>
          <Icon name="copy" size={12} colorValue={theme.desktop.mutedForeground} />
        </Touchable>
        <TaskStatusBadge status={task.status} />
      </View>
      <View style={styles.badgeRow}>
        <TaskSummaryBadges task={task} />
        <PullRequestControls pullRequest={pullRequest} />
      </View>
      {pullRequest.showDetect && pullRequest.detectDisabledReason ? (
        <Text variant="footnote" selectable style={styles.detectError}>
          {pullRequest.detectDisabledReason}
        </Text>
      ) : null}
      {labels.length > 0 ? (
        <View style={styles.badges}>
          {labels.map((label) => (
            <TaskLabelChip key={label} label={label} />
          ))}
        </View>
      ) : null}
      {children}
    </View>
  );
});

/** The type, priority, pull request, source issue, QA, AI QA, and subtask count badges. */
function TaskSummaryBadges({ task }: { task: TaskCard }): ReactElement {
  const subtasks = task.subtaskIds.length;
  return (
    <View style={[styles.badges, styles.grow]}>
      <IssueTypeBadge issueType={task.issueType} />
      <PriorityBadge priority={task.priority} />
      {task.pullRequest ? <PullRequestBadge pullRequest={task.pullRequest} /> : null}
      {task.sourceIssue ? <SourceIssueBadge sourceIssue={task.sourceIssue} /> : null}
      {isQaRejectedTask(task) ? <QaRejectedBadge /> : null}
      <TaskChip
        label={task.aiReviewEnabled ? "AI QA required" : "AI QA optional"}
        paint={task.aiReviewEnabled ? "status-success" : "status-neutral"}
      />
      {task.issueType === "epic" ? (
        <TaskChip label={subtasks === 1 ? "1 subtask" : `${subtasks} subtasks`} paint="violet" />
      ) : null}
    </View>
  );
}

/** Detect PR and Unlink PR at the end of the badge row. */
function PullRequestControls({
  pullRequest,
}: {
  pullRequest: SummaryPullRequestActions;
}): ReactElement | null {
  if (!pullRequest.showDetect && !pullRequest.showUnlink) return null;
  const { detectDisabledReason } = pullRequest;
  return (
    <View style={styles.pullRequestActions}>
      {pullRequest.showDetect ? (
        <GhostAction
          label={
            pullRequest.detecting
              ? TASK_PULL_REQUEST_ACTION_LABELS.detecting
              : TASK_PULL_REQUEST_ACTION_LABELS.detect
          }
          icon="link-2"
          busy={pullRequest.detecting}
          disabled={!pullRequest.enabled || detectDisabledReason !== null}
          accessibilityHint={detectDisabledReason ?? undefined}
          onPress={pullRequest.onDetect}
        />
      ) : null}
      {pullRequest.showUnlink ? (
        <GhostAction
          label={
            pullRequest.unlinking
              ? TASK_PULL_REQUEST_ACTION_LABELS.unlinking
              : TASK_PULL_REQUEST_ACTION_LABELS.unlink
          }
          icon="unlink"
          busy={pullRequest.unlinking}
          disabled={!pullRequest.enabled}
          onPress={pullRequest.onUnlink}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    gap: theme.space.md,
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.lg,
    borderBottomWidth: theme.hairline,
    borderBottomColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
  // The mark centers on the first line of the 26-point title.
  mark: { paddingTop: 4 },
  title: { flex: 1, color: theme.desktop.foreground },
  // The 44-point touch area of the menu control centers its icon on the first title line.
  accessory: { marginTop: -9, marginRight: -12 },
  idRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.md,
    marginTop: -6,
  },
  id: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 },
  idText: { flexShrink: 1, color: theme.desktop.mutedForeground },
  // The pull request controls stay at the end of the first badge line when the badges wrap.
  badgeRow: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.md },
  grow: { flex: 1 },
  badges: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  // A ghost control is 28 points tall and a badge 24, so the controls center on the first line.
  pullRequestActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    marginTop: -2,
  },
  ghost: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 28 },
  ghostLabel: { color: theme.desktop.mutedForeground },
  detectError: { marginTop: -6, textAlign: "right", color: theme.desktop.destructive },
}));
