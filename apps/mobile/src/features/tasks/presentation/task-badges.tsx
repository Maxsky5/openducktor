import type {
  IssueType,
  PullRequest,
  SourceIssueReference,
  TaskCard,
} from "@openducktor/contracts";
import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useLinkOpener } from "@/rich-content/links/use-link-opener";
import { useAppTheme } from "@/theme/app-theme-context";
import {
  issueTypePaint,
  priorityPaint,
  pullRequestPaint,
  sourceIssueLabel,
} from "./task-badge-paint";
import { TaskChip } from "./task-chip";
import { issueTypeChipPaint, priorityChipPaint, pullRequestIconColor } from "./task-chip-paint";

type ChipSize = "sm" | "md";

/** The desktop issue type badge: a colored capsule with the type icon and name. */
export const IssueTypeBadge = memo(function IssueTypeBadge({
  issueType,
  size = "md",
}: {
  issueType: IssueType;
  size?: ChipSize;
}): ReactElement {
  const paint = issueTypePaint(issueType);
  return (
    <TaskChip
      label={paint.label}
      icon={paint.icon}
      paint={issueTypeChipPaint(issueType)}
      size={size}
      accessibilityLabel={`Issue type ${paint.label}`}
    />
  );
});

/** The desktop priority badge: a colored capsule with a dot and the level, such as "P1". */
export const PriorityBadge = memo(function PriorityBadge({
  priority,
  size = "md",
}: {
  priority: number;
  size?: ChipSize;
}): ReactElement {
  const paint = priorityPaint(priority);
  return (
    <TaskChip
      label={paint.label}
      dot
      paint={priorityChipPaint(priority)}
      size={size}
      accessibilityLabel={`Priority ${paint.label}, ${paint.hint}`}
    />
  );
});

/**
 * The desktop pull request link: an outlined capsule with the state icon in its color, the
 * number, and the external link mark. It opens the pull request in the browser.
 */
export const PullRequestBadge = memo(function PullRequestBadge({
  pullRequest,
  size = "md",
}: {
  pullRequest: Pick<PullRequest, "number" | "state" | "url">;
  size?: ChipSize;
}): ReactElement {
  const theme = useAppTheme();
  const openLink = useLinkOpener(undefined);
  const paint = pullRequestPaint(pullRequest);
  return (
    <TaskChip
      label={paint.label}
      icon={paint.icon}
      iconColor={pullRequestIconColor(theme, pullRequest.state)}
      external
      paint="card"
      size={size}
      accessibilityLabel={`Pull request ${pullRequest.number}, ${paint.stateLabel}`}
      accessibilityHint="Opens the pull request in the browser."
      onPress={() => openLink(pullRequest.url)}
    />
  );
});

/** The desktop source issue link, such as "GitHub #12". It opens the issue in the browser. */
export const SourceIssueBadge = memo(function SourceIssueBadge({
  sourceIssue,
  size = "md",
}: {
  sourceIssue: Pick<SourceIssueReference, "providerId" | "number" | "url">;
  size?: ChipSize;
}): ReactElement {
  const openLink = useLinkOpener(undefined);
  const label = sourceIssueLabel(sourceIssue);
  return (
    <TaskChip
      label={label}
      icon="circle-dot"
      external
      paint="card"
      size={size}
      accessibilityLabel={`Source issue ${label}`}
      accessibilityHint="Opens the issue in the browser."
      onPress={() => openLink(sourceIssue.url)}
    />
  );
});

/** The desktop QA Rejected badge: QA rejected the previous implementation. */
export const QaRejectedBadge = memo(function QaRejectedBadge({
  size = "md",
}: {
  size?: ChipSize;
}): ReactElement {
  return (
    <TaskChip
      label="QA Rejected"
      paint="rose"
      size={size}
      accessibilityLabel="QA rejected the previous implementation"
    />
  );
});

/** The subtask count of a task, as the desktop card badge "2 subtasks". */
const SubtaskBadge = memo(function SubtaskBadge({
  count,
  size = "md",
}: {
  count: number;
  size?: ChipSize;
}): ReactElement {
  const label = count === 1 ? "1 subtask" : `${count} subtasks`;
  return <TaskChip label={label} paint="card-strong" size={size} />;
});

/** A task label, as the desktop label chip: a muted capsule with a tag icon. */
export const TaskLabelChip = memo(function TaskLabelChip({
  label,
  size = "md",
}: {
  label: string;
  size?: ChipSize;
}): ReactElement {
  return (
    <TaskChip
      label={label}
      icon="tag"
      paint="muted"
      size={size}
      weight="medium"
      accessibilityLabel={`Label ${label}`}
    />
  );
});

/** The count of labels that a card does not show, as the desktop "+N" label overflow. */
export const TaskLabelCountChip = memo(function TaskLabelCountChip({
  count,
  size = "md",
}: {
  count: number;
  size?: ChipSize;
}): ReactElement {
  return <TaskChip label={`+${count}`} paint="muted" size={size} weight="semibold" />;
});

/**
 * The status badges of a task, as the desktop card status row: QA Rejected, the subtask count,
 * the pull request, and the source issue. It renders nothing when the task has none.
 */
export const TaskStatusChips = memo(function TaskStatusChips({
  task,
  qaRejected,
  size = "md",
}: {
  task: Pick<TaskCard, "subtaskIds" | "pullRequest" | "sourceIssue">;
  qaRejected: boolean;
  size?: ChipSize;
}): ReactElement | null {
  const subtasks = task.subtaskIds.length;
  if (!qaRejected && subtasks === 0 && !task.pullRequest && !task.sourceIssue) return null;
  return (
    <View pointerEvents="box-none" style={styles.row}>
      {qaRejected ? <QaRejectedBadge size={size} /> : null}
      {subtasks > 0 ? <SubtaskBadge count={subtasks} size={size} /> : null}
      {task.pullRequest ? <PullRequestBadge pullRequest={task.pullRequest} size={size} /> : null}
      {task.sourceIssue ? <SourceIssueBadge sourceIssue={task.sourceIssue} size={size} /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
});
