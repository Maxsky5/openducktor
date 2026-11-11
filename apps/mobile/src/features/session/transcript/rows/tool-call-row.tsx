import {
  getToolLifecyclePhase,
  type ToolLifecyclePhase,
} from "@openducktor/frontend-core/sessions/messages/tool-lifecycle";
import {
  hasExpandableToolDetails,
  isRegularToolPreparing,
  readRegularToolTiming,
  readToolDetailAvailability,
  regularToolLineName,
  resolveRegularToolSummary,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranscriptRows } from "../transcript-rows-context";
import { ToolErrorPreview, ToolLine, type ToolLineTone } from "./row-parts";
import { toolIcon } from "./tool-icon";
import { QuestionDetails, ToolFileEdits } from "./tool-details";

const PATH_TOOL_TYPES: ReadonlySet<ToolMeta["toolType"]> = new Set(["read", "list", "file_edit"]);

/** The tone of the tool line: a failed or cancelled call, a call that prepares, or plain. */
const toolLineTone = (phase: ToolLifecyclePhase, preparing: boolean): ToolLineTone => {
  if (phase === "failed" || phase === "cancelled") return phase;
  return preparing ? "preparing" : "plain";
};

/** The state that a screen reader hears after the tool name and summary. */
const toolStateLabel = (phase: ToolLifecyclePhase, running: boolean): string => {
  if (phase === "failed") return ", failed";
  if (phase === "cancelled") return ", cancelled";
  return running ? ", running" : "";
};

/**
 * The desktop `RegularToolMessage`: one compact line with the tool name, its summary, and its
 * timing, and the error preview of a failed call under it. A press opens the input, output, and
 * error of the call in the tool details sheet. Question answers and file edit cards show under
 * the line.
 */
export const ToolCallRow = memo(function ToolCallRow({
  meta,
  messageId,
  messageContent,
  messageTimestamp,
  timeLabel,
  displayName,
  rowKey,
}: {
  meta: ToolMeta;
  messageId: string;
  messageContent: string;
  messageTimestamp: string;
  timeLabel: string;
  displayName: string;
  rowKey: string;
}): ReactElement {
  const { workingDirectory, openFullView } = useTranscriptRows();
  const phase = getToolLifecyclePhase(meta);
  const expandable = hasExpandableToolDetails(readToolDetailAvailability(meta));
  const summary = resolveRegularToolSummary(meta, messageContent, workingDirectory);
  const timing = readRegularToolTiming(meta, messageTimestamp);
  const preparing = isRegularToolPreparing(meta);
  const name = regularToolLineName(meta, displayName);
  const stateLabel = toolStateLabel(phase, timing.isActive && !preparing);
  const errorLabel = summary.errorPreview === null ? "" : `: ${summary.errorPreview}`;
  return (
    <View style={styles.row}>
      <ToolLine
        icon={toolIcon(meta)}
        name={name}
        summary={summary.text}
        summaryEllipsis={PATH_TOOL_TYPES.has(meta.toolType) ? "middle" : "tail"}
        tone={toolLineTone(phase, preparing)}
        active={timing.isActive}
        durationMs={timing.durationMs}
        timeLabel={timeLabel}
        onPress={
          expandable ? () => openFullView({ kind: "tool", messageId, title: displayName }) : null
        }
        accessibilityLabel={`${name}${summary.text.length > 0 ? `: ${summary.text}` : ""}${stateLabel}${errorLabel}`}
      />
      {summary.errorPreview === null ? null : <ToolErrorPreview text={summary.errorPreview} />}
      <QuestionDetails meta={meta} resetKey={rowKey} />
      <ToolFileEdits meta={meta} resetKey={rowKey} />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  // The desktop `space-y-1 py-0.5` around a tool line and its parts.
  row: { gap: theme.space.xs, paddingVertical: 2 },
}));
