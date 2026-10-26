import type { TaskCard } from "@openducktor/contracts";
import { toSubtasks } from "@openducktor/frontend-core/tasks/details/task-details-sheet-model";
import { useRouter } from "expo-router";
import type { PropsWithChildren, ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { routes } from "@/navigation/routes";
import { useAppTheme } from "@/theme/app-theme-context";
import { StatusLabel } from "@/ui/badge";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { IssueTypeBadge, PriorityBadge } from "../presentation/task-badges";
import { qaVerdictPresentation } from "../presentation/task-document-paint";
import { TaskStatusBadge } from "../presentation/task-status-badge";
import { DetailsCard, DetailsCount, DetailsItem, DetailsNote } from "./details-card";
import { taskTargetBranchPresentation } from "./task-details-model";

/** One fact of the Metadata card: the desktop uppercase label, then the value. */
function Fact({ label, children }: PropsWithChildren<{ label: string }>): ReactElement {
  return (
    <View style={styles.fact}>
      <Text variant="caption2" overline style={styles.factLabel}>
        {label}
      </Text>
      {children}
    </View>
  );
}

/** The target branch of the task, and why it does not resolve. */
function TargetBranchFact({ label, error }: { label: string; error: string | null }): ReactElement {
  return (
    <View accessible accessibilityLabel={`Target branch ${label}${error ? `. ${error}` : ""}`}>
      <Fact label="Target branch">
        <Text
          variant="monoSmall"
          numberOfLines={1}
          ellipsizeMode="middle"
          style={error ? styles.error : styles.value}
        >
          {label}
        </Text>
        {error ? (
          <Text variant="footnote" style={styles.muted}>
            {error}
          </Text>
        ) : null}
      </Fact>
    </View>
  );
}

/** The parent task: its ID, its title and status once it loads, and a link to its details. */
function ParentFact({
  parentId,
  parent,
  onOpen,
}: {
  parentId: string;
  parent: TaskCard | null;
  onOpen: () => void;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <Touchable
      feedback="opacity"
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Parent task ${parentId}${parent ? `, ${parent.title}` : ""}`}
      accessibilityHint="Opens the parent task."
      style={styles.link}
    >
      <View style={styles.grow}>
        <Fact label="Parent">
          <Text variant="monoSmall" numberOfLines={1} style={styles.value}>
            {parentId}
          </Text>
          {parent ? (
            <View style={styles.parent}>
              <Text variant="subhead" numberOfLines={1} style={[styles.grow, styles.value]}>
                {parent.title}
              </Text>
              <TaskStatusBadge status={parent.status} size="sm" />
            </View>
          ) : null}
        </Fact>
      </View>
      <Icon name="chevron-right" size={15} colorValue={theme.desktop.mutedForeground} />
    </Touchable>
  );
}

/** The open state of a details card and its toggle. */
type CardCollapse = { collapsed: boolean; onToggle: () => void };

/**
 * The facts of a task, as the desktop Metadata card: the target branch, the parent task, and the
 * QA verdict. The pull request and AI QA show as badges in the header. The parent opens its
 * details.
 */
export function TaskMetadataSection({
  workspaceId,
  task,
  tasks,
  collapsed,
  onToggle,
}: CardCollapse & {
  workspaceId: string;
  task: TaskCard;
  tasks: readonly TaskCard[];
}): ReactElement {
  const router = useRouter();
  const verdict = qaVerdictPresentation(task.artifactSummary.qaReport.verdict);
  const parentId = task.parentId ?? null;
  const parent = parentId ? (tasks.find((entry) => entry.id === parentId) ?? null) : null;
  const branch = taskTargetBranchPresentation(task);
  return (
    <DetailsCard title="Metadata" icon="layers" collapsed={collapsed} onToggle={onToggle}>
      <View style={styles.facts}>
        {branch ? <TargetBranchFact label={branch.label} error={branch.error} /> : null}
        {parentId ? (
          <ParentFact
            parentId={parentId}
            parent={parent}
            onOpen={() => router.push(routes.task(workspaceId, parentId))}
          />
        ) : null}
        <View accessible accessibilityLabel={`QA verdict: ${verdict.label}`}>
          <Fact label="QA verdict">
            <StatusLabel label={verdict.label} tone={verdict.tone} />
          </Fact>
        </View>
      </View>
    </DetailsCard>
  );
}

/**
 * The subtasks of a task, as the desktop Subtasks card, with their status, type, and priority.
 * A subtask opens its details.
 */
export function TaskSubtasksSection({
  workspaceId,
  task,
  tasks,
  collapsed,
  onToggle,
}: CardCollapse & {
  workspaceId: string;
  task: TaskCard;
  tasks: readonly TaskCard[];
}): ReactElement {
  const router = useRouter();
  const subtasks = toSubtasks(task, new Map(tasks.map((entry) => [entry.id, entry])));
  const openTask = (id: string) => router.push(routes.task(workspaceId, id));
  return (
    <DetailsCard
      title="Subtasks"
      icon="git-branch"
      trailing={<DetailsCount value={String(subtasks.length)} />}
      collapsed={collapsed}
      onToggle={onToggle}
    >
      {subtasks.length === 0 ? <DetailsNote text="No subtasks yet." /> : null}
      {subtasks.map((subtask) => (
        <DetailsItem
          key={subtask.id}
          accessibilityLabel={`Subtask ${subtask.id}, ${subtask.title}`}
          accessibilityHint="Opens the subtask."
          onPress={() => openTask(subtask.id)}
        >
          <View style={styles.subtaskTop}>
            <Text
              variant="subhead"
              weight="semibold"
              numberOfLines={2}
              style={[styles.grow, styles.value]}
            >
              {subtask.title}
            </Text>
            <TaskStatusBadge status={subtask.status} size="sm" />
          </View>
          <Text variant="monoSmall" numberOfLines={1} style={styles.muted}>
            {subtask.id}
          </Text>
          <View style={styles.badges}>
            <IssueTypeBadge issueType={subtask.issueType} size="sm" />
            <PriorityBadge priority={subtask.priority} size="sm" />
          </View>
        </DetailsItem>
      ))}
    </DetailsCard>
  );
}

const styles = StyleSheet.create((theme) => ({
  facts: {
    gap: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.sm,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.muted,
  },
  fact: { gap: 4 },
  factLabel: { color: theme.desktop.mutedForeground },
  value: { color: theme.desktop.foreground },
  muted: { color: theme.desktop.mutedForeground },
  error: { color: theme.desktop.destructive },
  link: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  grow: { flex: 1, minWidth: 0 },
  parent: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  subtaskTop: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 2 },
}));
