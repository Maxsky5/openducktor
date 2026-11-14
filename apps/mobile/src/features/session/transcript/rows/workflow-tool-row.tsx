import {
  getToolLifecyclePhase,
  type ToolLifecyclePhase,
} from "@openducktor/frontend-core/sessions/messages/tool-lifecycle";
import {
  isWorkflowToolActive,
  readToolTiming,
  readWorkflowToolCard,
  readWorkflowToolDetailsTitle,
  workflowToolStatusLabel,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import {
  type ArtifactToolHeading,
  readArtifactToolCall,
  readArtifactToolTaskId,
} from "@openducktor/frontend-core/sessions/messages/artifact-tool-call";
import type { OdtToolName } from "@openducktor/contracts";
import { memo, type ReactElement, type ReactNode, useMemo } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { workflowDocumentKey } from "@/features/tasks/artifacts/artifact-list-model";
import { PullRequestLinkButton } from "@/features/workflow/pull-requests/pull-request-link-button";
import type { HostDocumentKey } from "@/features/tasks/documents/document-rows";
import { useToolTaskWorkflow } from "../use-tool-task-workflow";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { type AppTheme, sansWeight } from "@/theme/tokens";
import { Button } from "@/ui/button";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { useTranscriptRows } from "../transcript-rows-context";
import { StatusPill, ToolTiming } from "./row-parts";
import { toolIcon } from "./tool-icon";
import { toolActivity } from "./tool-status-presentation";

type Family = "info" | "pending" | "destructive" | "cancelled" | "success";

/** The family of the card of each phase, from the desktop article classes. */
const CARD_FAMILIES = {
  preparing: "info",
  executing: "info",
  queued: "pending",
  failed: "destructive",
  cancelled: "cancelled",
  completed: "success",
} as const satisfies Record<ToolLifecyclePhase, Family>;

/** The family of the status pill of each phase, from the desktop `WORKFLOW_TOOL_APPEARANCE`. */
const PILL_FAMILIES = {
  preparing: "info",
  executing: "info",
  queued: "pending",
  failed: "destructive",
  cancelled: "cancelled",
  completed: "pending",
} as const satisfies Record<ToolLifecyclePhase, Family>;

const familyColors = (theme: AppTheme, family: Family) => {
  const { desktop } = theme;
  switch (family) {
    case "info":
      return {
        surface: desktop.infoSurface,
        border: desktop.infoBorder,
        text: desktop.infoSurfaceForeground,
      };
    case "pending":
      return {
        surface: desktop.pendingSurface,
        border: desktop.pendingBorder,
        text: desktop.pendingSurfaceForeground,
      };
    case "destructive":
      return {
        surface: desktop.destructiveSurface,
        border: desktop.destructiveBorder,
        text: desktop.destructiveSurfaceForeground,
      };
    case "cancelled":
      return {
        surface: desktop.cancelledSurface,
        border: desktop.cancelledBorder,
        text: desktop.cancelledSurfaceForeground,
      };
    case "success":
      return {
        surface: desktop.successSurface,
        border: desktop.successBorder,
        text: desktop.successSurfaceForeground,
      };
  }
};

/**
 * The desktop `WorkflowToolMessage`: a card in the color of the call phase, with the tool icon,
 * its title, the pull request of the call, the uppercase status pill, and the timing. A workflow
 * event call takes its event as the title. A failed call shows its error message under the header.
 * A press on the title shows the call in the tool details sheet, as for the other tool calls, with
 * the note of a workflow event.
 *
 * A phone has no document panel beside the transcript, so a call that saves a task document, such
 * as Set Plan, shows Open once the document is saved. A call that saves a file shows Open, which
 * opens the file in its artifact view.
 */
export const WorkflowToolRow = memo(function WorkflowToolRow({
  meta,
  messageId,
  odtTool = null,
  messageTimestamp,
  timeLabel,
  displayName,
  icon,
  document,
  action,
  summary,
}: {
  meta: ToolMeta;
  /** The message of the call. A press on the title shows it in the tool details sheet. */
  messageId: string;
  /** The ODT tool of the call, as `presentToolCall` resolved it. */
  odtTool?: OdtToolName | null | undefined;
  messageTimestamp: string;
  timeLabel: string;
  displayName: string;
  /** The short line under the header, as on desktop, such as the event and note of an event. */
  summary?: string | undefined;
  /** The tool type icon when undefined. */
  icon?: IconName | undefined;
  /** The task document that the call saves, or null. */
  document: HostDocumentKey | null;
  /** A control at the end of the header, such as Open for a saved file. */
  action?: ReactNode;
}): ReactElement {
  const theme = useAppTheme();
  const { onOpenDocument, openFullView } = useTranscriptRows();
  const openDocument = document ? onOpenDocument : null;
  const phase = getToolLifecyclePhase(meta);
  const statusLabel = workflowToolStatusLabel(phase);
  const active = isWorkflowToolActive(phase);
  const { durationMs } = readToolTiming(meta, messageTimestamp);
  const card = familyColors(theme, CARD_FAMILIES[phase]);
  const pill = familyColors(theme, PILL_FAMILIES[phase]);
  const toolCard = readWorkflowToolCard({ meta, odtTool, displayName });
  const openButton =
    document && openDocument && phase === "completed" ? (
      <OpenDocumentButton document={document} onPress={() => openDocument(document)} />
    ) : null;
  // The first header line is as tall as the tallest control on it, so all its items share one
  // center line.
  const lineStyle = openButton || action ? styles.buttonLine : styles.line;
  // The text color of the phase. Timing is the text at 75%.
  const text = card.text;
  return (
    <View
      style={[styles.card, { backgroundColor: card.surface, borderColor: card.border }]}
      accessible={false}
    >
      <View style={styles.headerRow}>
        <View style={styles.header}>
          <Icon name={icon ?? toolIcon(meta, toolCard.iconKind)} size={14} colorValue={text} />
          <WorkflowToolTitle
            title={toolCard.title}
            statusLabel={statusLabel}
            active={active}
            color={text}
            onPress={() =>
              openFullView({
                kind: "tool",
                messageId,
                title: readWorkflowToolDetailsTitle(displayName, toolCard.title),
              })
            }
            lineStyle={lineStyle}
          />
          {toolCard.pullRequest ? (
            <PullRequestLinkButton pullRequest={toolCard.pullRequest} />
          ) : null}
          {statusLabel ? (
            // The title label already says the status.
            <View {...HIDDEN_FROM_SCREEN_READERS}>
              <StatusPill
                label={statusLabel}
                surface={pill.surface}
                border={pill.border}
                text={pill.text}
              />
            </View>
          ) : null}
        </View>
        <View style={[styles.trailing, lineStyle]}>
          <View {...HIDDEN_FROM_SCREEN_READERS}>
            <ToolTiming
              activity={toolActivity(phase)}
              durationMs={durationMs}
              timeLabel={timeLabel}
              color={withAlpha(text, 0.75)}
            />
          </View>
          {openButton}
          {action}
        </View>
      </View>
      {toolCard.error ? (
        <Text style={[styles.error, { color: theme.desktop.destructiveSurfaceForeground }]}>
          {toolCard.error.message}
        </Text>
      ) : summary ? (
        <Text style={[styles.summary, { color: withAlpha(text, 0.75) }]}>{summary}</Text>
      ) : null}
    </View>
  );
});

/** The title of a card. A press on it shows the call in the tool details sheet. */
function WorkflowToolTitle({
  title,
  statusLabel,
  active,
  color,
  onPress,
  lineStyle,
}: {
  title: string;
  statusLabel: string | null;
  active: boolean;
  color: string;
  onPress: () => void;
  /** The height of the first header line. */
  lineStyle: StyleProp<ViewStyle>;
}): ReactElement {
  return (
    <Touchable
      feedback="opacity"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${statusLabel ? statusLabel.toLowerCase() : "done"}`}
      accessibilityHint="Shows the details."
      accessibilityState={{ busy: active }}
      hitSlop={{ top: 8, bottom: 8 }}
      containerStyle={[styles.nameContainer, lineStyle]}
      style={styles.nameButton}
    >
      <Text style={[styles.name, { color }]}>{title}</Text>
    </Touchable>
  );
}

const HEADING_ICONS = {
  artifact: "file-text",

  document: "file-text",
  review_passed: "shield-check",
  review_failed: "shield-x",
  review: "shield-check",
  free: "file",
} as const satisfies Record<ArtifactToolHeading, IconName>;

/** The desktop `ArtifactToolMessage`: a workflow card titled with the artifact that the call saves. */
export const ArtifactToolRow = memo(function ArtifactToolRow({
  meta,
  operation,
  displayName,
  ...props
}: {
  meta: ToolMeta;
  operation: "set" | "delete";
  displayName: string;
  messageId: string;
  messageTimestamp: string;
  timeLabel: string;
}): ReactElement {
  const rawCall = useMemo(
    () => (operation === "set" ? readArtifactToolCall(meta) : null),
    [meta, operation],
  );
  const taskId = rawCall?.saved?.taskId ?? readArtifactToolTaskId(meta);
  const workflow = useToolTaskWorkflow(taskId);
  const call = useMemo(
    () => (operation === "set" ? readArtifactToolCall(meta, workflow.task?.taskWorkflow) : null),
    [meta, operation, workflow.task?.taskWorkflow],
  );
  if (!call) {
    return (
      <WorkflowToolRow
        {...props}
        meta={meta}
        displayName={displayName}
        icon="file-x"
        document={null}
      />
    );
  }
  const { saved } = call;
  return (
    <>
      <WorkflowToolRow
        {...props}
        meta={meta}
        displayName={call.title}
        icon={HEADING_ICONS[call.heading]}
        document={
          call.heading === "free" ||
          !call.code ||
          !workflow.task?.taskWorkflow.definition.artifacts.some(({ id }) => id === call.code)
            ? null
            : workflowDocumentKey(call.code)
        }
        action={
          saved?.classification === "free" ? (
            <OpenArtifactButton name={saved.name} taskId={saved.taskId} code={saved.code} />
          ) : null
        }
      />
      {workflow.error ? (
        <Text variant="footnote" accessibilityRole="alert">
          {workflow.error}
        </Text>
      ) : taskId && !workflow.task ? (
        <Text variant="footnote">Loading task workflow...</Text>
      ) : null}
    </>
  );
});

/** Opens a saved file in its artifact view, as the desktop Open button of the call. */
function OpenArtifactButton({
  name,
  taskId,
  code,
}: {
  name: string;
  taskId: string;
  code: string;
}): ReactElement {
  const { onOpenArtifact } = useTranscriptRows();
  return (
    <Button
      label="Open"
      icon="eye"
      variant="outline"
      size="sm"
      accessibilityLabel={`Open ${name}`}
      onPress={() => onOpenArtifact(taskId, code)}
    />
  );
}

/** The short labels of the Open button, which shares its row with the tool name. */
/** Opens the saved document with the eye of a preview, as the other buttons of the app. */
function OpenDocumentButton({
  document,
  onPress,
}: {
  document: HostDocumentKey;
  onPress: () => void;
}): ReactElement {
  return (
    <Button
      label="Open"
      icon="eye"
      variant="outline"
      size="sm"
      accessibilityLabel={`Open document ${document}`}
      onPress={onPress}
    />
  );
}

/** Hides a part that a nearby accessibility label already says. */
const HIDDEN_FROM_SCREEN_READERS = {
  accessibilityElementsHidden: true,
  importantForAccessibility: "no-hide-descendants",
} as const;

const styles = StyleSheet.create((theme) => ({
  // The desktop article: `rounded-md border px-3 py-2 my-2`.
  card: {
    marginVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    gap: theme.space.sm,
  },
  // The timing and the buttons stay at the end of the first header line. The title, the pull
  // request, and the status pill wrap on the start side.
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
  header: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.space.sm,
    rowGap: theme.space.xs,
  },
  trailing: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, flexShrink: 0 },
  // The height of the pull request link.
  line: { minHeight: 28 },
  // The height of a small button.
  buttonLine: { minHeight: 32 },
  nameContainer: { flexShrink: 1, minWidth: 0, justifyContent: "center" },
  nameButton: { flexDirection: "row", alignItems: "center", gap: theme.space.xs },
  name: { ...sansWeight("semibold"), fontSize: 12, lineHeight: 16, flexShrink: 1 },
  // The desktop summary: `text-[11px] text-current/75` under the header.
  summary: { fontSize: 11, lineHeight: 15 },
  // The desktop error line: `text-[11px] font-medium text-destructive-surface-foreground`.
  error: { ...sansWeight("medium"), fontSize: 11, lineHeight: 15 },
}));
