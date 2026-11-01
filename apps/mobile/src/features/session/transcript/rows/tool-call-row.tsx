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
  resolveRegularToolSummaryText,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranscriptRows } from "../transcript-rows-context";
import { useDisclosure } from "./disclosure";
import { LineDetails, ToolLine, type ToolLineTone } from "./row-parts";
import { toolIcon } from "./tool-icon";
import { QuestionDetails, ToolDetails, ToolFileEdits, useCardDetailsColors } from "./tool-details";

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
 * timing. A press opens the Input, Output, and Error boxes, as the desktop `<details>`. Question
 * answers and file edit cards show under the line.
 */
export const ToolCallRow = memo(function ToolCallRow({
  meta,
  messageContent,
  messageTimestamp,
  timeLabel,
  displayName,
  rowKey,
}: {
  meta: ToolMeta;
  messageContent: string;
  messageTimestamp: string;
  timeLabel: string;
  displayName: string;
  rowKey: string;
}): ReactElement {
  const { workingDirectory } = useTranscriptRows();
  const colors = useCardDetailsColors();
  const disclosure = useDisclosure(false, rowKey);
  const phase = getToolLifecyclePhase(meta);
  const availability = readToolDetailAvailability(meta);
  const expandable = hasExpandableToolDetails(availability);
  const summary = resolveRegularToolSummaryText(meta, messageContent, workingDirectory);
  const timing = readRegularToolTiming(meta, messageTimestamp);
  const preparing = isRegularToolPreparing(meta);
  const name = regularToolLineName(meta, displayName);
  const stateLabel = toolStateLabel(phase, timing.isActive && !preparing);
  return (
    <View style={styles.row}>
      <ToolLine
        icon={toolIcon(meta)}
        name={name}
        summary={summary}
        summaryEllipsis={PATH_TOOL_TYPES.has(meta.toolType) ? "middle" : "tail"}
        tone={toolLineTone(phase, preparing)}
        active={timing.isActive}
        durationMs={timing.durationMs}
        timeLabel={timeLabel}
        disclosure={expandable ? disclosure : null}
        accessibilityLabel={`${name}${summary.length > 0 ? `: ${summary}` : ""}${stateLabel}`}
      />
      {expandable && disclosure.open ? (
        <LineDetails animate={disclosure.pressed}>
          <ToolDetails
            meta={meta}
            resetKey={rowKey}
            hasInput={availability.hasInput}
            hasOutput={availability.hasOutput}
            hasError={availability.hasError}
            colors={colors}
          />
        </LineDetails>
      ) : null}
      <QuestionDetails meta={meta} resetKey={rowKey} />
      <ToolFileEdits meta={meta} resetKey={rowKey} />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  // The desktop `space-y-1 py-0.5` around a tool line and its parts.
  row: { gap: theme.space.xs, paddingVertical: 2 },
}));
