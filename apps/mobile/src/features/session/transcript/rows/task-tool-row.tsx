import type { PublicTaskSummaryTask } from "@openducktor/contracts";
import {
  buildTaskToolSummary,
  INVALID_TASK_TOOL_RESULT_MESSAGE,
  resolveTaskToolTask,
  showsInvalidTaskToolAlert,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-task-tool-model";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import type { AgentChatTaskToolName } from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import { memo, type ReactElement, useCallback, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  IssueTypeBadge,
  PriorityBadge,
  TaskLabelChip,
} from "@/features/tasks/presentation/task-badges";
import { TaskStatusBadge } from "@/features/tasks/presentation/task-status-badge";
import { useCopyTaskId } from "@/features/tasks/presentation/use-copy-task-id";
import { useMarkdownBlocks } from "@/rich-content/markdown/markdown-view";
import { plainText } from "@/rich-content/markdown/markdown-layout";
import { useAppTheme } from "@/theme/app-theme-context";
import { monoWeight, sansWeight } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { useTranscriptRows } from "../transcript-rows-context";
import { ToolCallRow } from "./tool-call-row";

/** The desktop `TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS`. */
const DESCRIPTION_PREVIEW_CHARACTERS = 480;

/**
 * The desktop `AgentChatTaskTool`: the tool line, then the card of the task that the call
 * returned. The card title or Open opens the task details.
 */
export const TaskToolRow = memo(function TaskToolRow({
  meta,
  tool,
  messageContent,
  messageTimestamp,
  timeLabel,
  rowKey,
}: {
  meta: ToolMeta;
  tool: AgentChatTaskToolName;
  messageContent: string;
  messageTimestamp: string;
  timeLabel: string;
  rowKey: string;
}): ReactElement {
  const task = useMemo(() => resolveTaskToolTask(tool, meta), [meta, tool]);
  const summaryMeta = useMemo(
    () => ({ ...meta, preview: buildTaskToolSummary(tool, meta, task) }),
    [meta, task, tool],
  );
  return (
    <View style={styles.section} accessibilityLabel={tool}>
      <ToolCallRow
        meta={summaryMeta}
        messageContent={messageContent}
        messageTimestamp={messageTimestamp}
        timeLabel={timeLabel}
        displayName={tool}
        rowKey={rowKey}
      />
      {task ? <TaskResultCard task={task} rowKey={rowKey} /> : null}
      {showsInvalidTaskToolAlert(tool, meta, task) ? (
        <Text accessibilityRole="alert" style={styles.invalid}>
          {INVALID_TASK_TOOL_RESULT_MESSAGE}
        </Text>
      ) : null}
    </View>
  );
});

/**
 * The desktop `TaskResultCard`: the title, the task ID with copy and Open, the issue type,
 * priority, and status badges, a five-line description preview, and the labels.
 */
function TaskResultCard({
  task,
  rowKey,
}: {
  task: PublicTaskSummaryTask;
  rowKey: string;
}): ReactElement {
  const theme = useAppTheme();
  const { onOpenTask } = useTranscriptRows();
  const copyTaskId = useCopyTaskId();
  const open = useCallback(() => onOpenTask(task.id), [onOpenTask, task.id]);
  const copy = useCallback(() => copyTaskId(task.id), [copyTaskId, task.id]);
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Touchable
          feedback="opacity"
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={`Task ${task.title}`}
          accessibilityHint="Opens the task details."
        >
          <Text style={styles.title}>{task.title}</Text>
        </Touchable>
        <View style={styles.idLine}>
          <Text numberOfLines={1} ellipsizeMode="middle" selectable style={styles.id}>
            {task.id}
          </Text>
          <Touchable
            feedback="opacity"
            onPress={copy}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Copy task ID"
          >
            <Icon name="copy" size={12} colorValue={theme.desktop.mutedForeground} />
          </Touchable>
          <Touchable
            feedback="opacity"
            onPress={open}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Open task details"
            style={styles.open}
          >
            <Icon
              name="square-arrow-out-up-right"
              size={12}
              colorValue={theme.desktop.mutedForeground}
            />
            <Text style={styles.openText}>Open</Text>
          </Touchable>
        </View>
      </View>
      <View style={styles.content}>
        <View style={styles.badges}>
          <IssueTypeBadge issueType={task.issueType} />
          <PriorityBadge priority={task.priority} />
          <TaskStatusBadge status={task.status} />
        </View>
        {task.description ? (
          <DescriptionPreview description={task.description} revision={`${rowKey}:${task.id}`} />
        ) : null}
        {task.labels.length > 0 ? (
          <View style={styles.badges}>
            {task.labels.map((label) => (
              <TaskLabelChip key={label} label={label} />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The desktop description preview: compact muted text cut at five lines. The phone shows the
 * text of each block without its Markdown marks.
 */
function DescriptionPreview({
  description,
  revision,
}: {
  description: string;
  revision: string;
}): ReactElement {
  const document = useMarkdownBlocks(
    description.slice(0, DESCRIPTION_PREVIEW_CHARACTERS),
    revision,
  );
  const text = useMemo(
    () =>
      document.blocks
        .map((block) => plainText(block.node).trim())
        .filter((part) => part.length > 0)
        .join("\n"),
    [document],
  );
  return (
    <Text numberOfLines={5} style={styles.description}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The desktop `flex flex-col gap-2` section.
  section: { gap: theme.space.sm },
  invalid: {
    ...sansWeight("regular"),
    fontSize: 14,
    lineHeight: 20,
    color: theme.desktop.destructive,
    paddingHorizontal: theme.space.xs,
  },
  // The desktop Card: `rounded-xl border border-border bg-card shadow-sm`, with `mb-3`.
  card: {
    marginBottom: theme.space.md,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
    boxShadow: theme.shadows.card,
    overflow: "hidden",
  },
  header: {
    gap: 6,
    paddingHorizontal: theme.space.lg,
    paddingTop: theme.space.lg,
  },
  title: {
    ...sansWeight("semibold"),
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.2,
    color: theme.desktop.cardForeground,
  },
  idLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  id: {
    ...monoWeight("regular"),
    flexShrink: 1,
    fontSize: 11.5,
    lineHeight: 16,
    color: theme.desktop.mutedForeground,
  },
  open: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    borderRadius: theme.radius.md,
  },
  openText: {
    ...sansWeight("regular"),
    fontSize: 11.5,
    lineHeight: 16,
    color: theme.desktop.mutedForeground,
  },
  content: { gap: theme.space.md, padding: theme.space.lg },
  badges: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  description: {
    ...sansWeight("regular"),
    fontSize: 14,
    lineHeight: 22,
    color: theme.desktop.mutedForeground,
  },
}));
