import {
  getToolLifecyclePhase,
  type ToolLifecyclePhase,
} from "@openducktor/frontend-core/sessions/messages/tool-lifecycle";
import {
  isWorkflowToolActive,
  readToolDetailAvailability,
  readToolTiming,
  workflowToolStatusLabel,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import {
  type ArtifactToolHeading,
  readArtifactToolCall,
} from "@openducktor/frontend-core/sessions/messages/artifact-tool-call";
import { memo, type ReactElement, type ReactNode, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { HostDocumentKey } from "@/features/tasks/documents/document-rows";
import { DOCUMENT_PANEL_COPY } from "@/features/tasks/documents/documents-panel-model";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { type AppTheme, sansWeight } from "@/theme/tokens";
import { Button } from "@/ui/button";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { useTranscriptRows } from "../transcript-rows-context";
import { StatusPill, ToolTiming } from "./row-parts";
import { toolIcon } from "./tool-icon";
import { ToolDetails, type ToolDetailsColors } from "./tool-details";

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
 * its name, the uppercase status pill, and the timing. Its Input, Output, and Error boxes show
 * under the header; the Error box opens when the call failed.
 *
 * A phone has no document panel beside the transcript, so a call that saves a task document, such
 * as Set Plan, shows Open instead of its Input and Output once the document is saved. A call that
 * saves a file shows Open, which opens the file in its artifact view.
 */
export const WorkflowToolRow = memo(function WorkflowToolRow({
  meta,
  messageTimestamp,
  timeLabel,
  displayName,
  icon,
  document,
  action,
  rowKey,
}: {
  meta: ToolMeta;
  messageTimestamp: string;
  timeLabel: string;
  displayName: string;
  /** The tool type icon when undefined. */
  icon?: IconName | undefined;
  /** The task document that the call saves, or null. */
  document: HostDocumentKey | null;
  /** A control at the end of the header, such as Open for a saved file. */
  action?: ReactNode;
  rowKey: string;
}): ReactElement {
  const theme = useAppTheme();
  const { onOpenDocument } = useTranscriptRows();
  const openDocument = document ? onOpenDocument : null;
  const phase = getToolLifecyclePhase(meta);
  const statusLabel = workflowToolStatusLabel(phase);
  const { durationMs } = readToolTiming(meta, messageTimestamp);
  const card = familyColors(theme, CARD_FAMILIES[phase]);
  const pill = familyColors(theme, PILL_FAMILIES[phase]);
  // The text color of the phase. Timing is the text at 75%; box outlines are the text at 20%.
  const text = card.text;
  const colors = useMemo<ToolDetailsColors>(
    () => ({
      frame: { borderColor: withAlpha(text, 0.2), backgroundColor: theme.desktop.card },
      text,
      errorFrame: {
        borderColor: withAlpha(text, 0.2),
        backgroundColor: withAlpha(theme.desktop.muted, 0.9),
      },
      errorText: text,
    }),
    [text, theme.desktop],
  );
  return (
    <View
      style={[styles.card, { backgroundColor: card.surface, borderColor: card.border }]}
      accessible={false}
    >
      <View style={styles.headerRow}>
        <View
          style={styles.header}
          accessible
          accessibilityRole="text"
          accessibilityLabel={`${displayName}, ${statusLabel ? statusLabel.toLowerCase() : "done"}`}
          accessibilityState={{ busy: isWorkflowToolActive(phase) }}
        >
          <Icon name={icon ?? toolIcon(meta)} size={14} colorValue={text} />
          <Text numberOfLines={1} style={[styles.name, { color: text }]}>
            {displayName}
          </Text>
          {statusLabel ? (
            <StatusPill
              label={statusLabel}
              surface={pill.surface}
              border={pill.border}
              text={pill.text}
            />
          ) : null}
          <ToolTiming
            active={isWorkflowToolActive(phase)}
            durationMs={durationMs}
            timeLabel={timeLabel}
            color={withAlpha(text, 0.75)}
          />
        </View>
        {document && openDocument && phase === "completed" ? (
          <OpenDocumentButton document={document} onPress={() => openDocument(document)} />
        ) : null}
        {action}
      </View>
      <WorkflowToolDetails
        meta={meta}
        rowKey={rowKey}
        colors={colors}
        opensDocument={openDocument !== null}
        failed={phase === "failed"}
      />
    </View>
  );
});

/** The Input, Output, and Error boxes. A call that opens a document shows only its error. */
function WorkflowToolDetails({
  meta,
  rowKey,
  colors,
  opensDocument,
  failed,
}: {
  meta: ToolMeta;
  rowKey: string;
  colors: ToolDetailsColors;
  opensDocument: boolean;
  failed: boolean;
}): ReactElement | null {
  const { hasInput, hasOutput, hasError } = readToolDetailAvailability(meta);
  if (opensDocument ? !hasError : !(hasInput || hasOutput || hasError)) return null;
  return (
    <View style={styles.details}>
      <ToolDetails
        meta={meta}
        resetKey={rowKey}
        hasInput={!opensDocument && hasInput}
        hasOutput={
          !opensDocument &&
          (meta.resultContent !== undefined || (hasOutput && Boolean(meta.output)))
        }
        hasError={hasError}
        colors={colors}
        errorOpen={failed}
      />
    </View>
  );
}

const HEADING_ICONS = {
  spec: "file-text",
  plan: "list-checks",
  qa_approved: "shield-check",
  qa_rejected: "shield-x",
  qa_report: "shield-check",
  free: "file",
} as const satisfies Record<ArtifactToolHeading, IconName>;

/** The Documents view of each workflow heading. A saved file opens in its artifact view instead. */
const HEADING_DOCUMENTS = {
  spec: "spec",
  plan: "plan",
  qa_approved: "qa",
  qa_rejected: "qa",
  qa_report: "qa",
  free: null,
} as const satisfies Record<ArtifactToolHeading, HostDocumentKey | null>;

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
  messageTimestamp: string;
  timeLabel: string;
  rowKey: string;
}): ReactElement {
  const call = useMemo(
    () => (operation === "set" ? readArtifactToolCall(meta) : null),
    [meta, operation],
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
    <WorkflowToolRow
      {...props}
      meta={meta}
      displayName={call.title}
      icon={HEADING_ICONS[call.heading]}
      document={HEADING_DOCUMENTS[call.heading]}
      action={
        saved?.classification === "free" ? (
          <OpenArtifactButton name={saved.name} taskId={saved.taskId} code={saved.code} />
        ) : null
      }
    />
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
const OPEN_LABELS = {
  spec: "Open Spec",
  plan: "Open Plan",
  qa: "Open QA Report",
} as const satisfies Record<HostDocumentKey, string>;

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
      label={OPEN_LABELS[document]}
      icon="eye"
      variant="outline"
      size="sm"
      accessibilityLabel={`Open the ${DOCUMENT_PANEL_COPY[document].title}`}
      onPress={onPress}
    />
  );
}

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
  headerRow: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  header: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    minHeight: 24,
  },
  name: { ...sansWeight("semibold"), fontSize: 12, lineHeight: 16, flexShrink: 1 },
  details: { gap: theme.space.sm },
}));
