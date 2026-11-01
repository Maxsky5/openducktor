import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import { formatTurnDurationLabel } from "@openducktor/frontend-core/sessions/transcript/format-agent-duration";
import { getSubagentMessageSessionKey } from "@openducktor/frontend-core/sessions/transcript/subagent-session-key";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import { useFlashListContext } from "@shopify/flash-list";
import { memo, type ReactElement, useCallback } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AnswerPartRow, AssistantMessageRow } from "./rows/assistant-message-row";
import { CompactionRow } from "./rows/compaction-row";
import { ComputerUseRow } from "./rows/computer-use-row";
import { ImageGenerationRow } from "./rows/image-generation-row";
import { NoticeRow } from "./rows/notice-row";
import { ReasoningPartRow, ReasoningRow } from "./rows/reasoning-row";
import { RowLayoutProvider } from "./rows/disclosure";
import { SeparatorRow } from "./rows/separator-row";
import { SubagentRow } from "./rows/subagent-row";
import { SystemRow } from "./rows/system-row";
import { TaskToolRow } from "./rows/task-tool-row";
import { ToolCallRow } from "./rows/tool-call-row";
import { UserMessageRow } from "./rows/user-message-row";
import { ArtifactToolRow, WorkflowToolRow } from "./rows/workflow-tool-row";
import { useMessageStreaming, useSubagentPendingCount } from "./transcript-row-state";
import type { MessagePartItem } from "./transcript-message-parts";
import { messageRowKind } from "./transcript-row-type";
import { useTranscriptRows } from "./transcript-rows-context";
import { messageTimeLabel } from "./transcript-text";

export type TranscriptRowProps = { item: AgentChatTranscriptRow | MessagePartItem };

/**
 * One transcript row, as the desktop `AgentChatThreadRow`. The list keeps the object of an
 * unchanged row, so a streamed change renders only the row that changed. The row reads its
 * streaming state and its Subagent pending input from the row state store, so a change of either
 * renders only the rows that it changes. A part that opens or closes asks the list to measure the
 * row again and to keep it in place, in the same frame.
 */
export const TranscriptRow = memo(function TranscriptRow({
  item,
}: TranscriptRowProps): ReactElement {
  const { rowState, parentSession, beforeRowResize } = useTranscriptRows();
  const list = useFlashListContext();
  const layoutRow = useCallback(() => {
    beforeRowResize(item.key);
    list?.layout();
  }, [beforeRowResize, item.key, list]);
  const message = item.kind === "message" ? item.message : null;
  const messageId = item.kind === "message_part" ? item.messageId : message?.id;
  const isStreaming = useMessageStreaming(rowState, messageId ?? "");
  const subagentSessionKey =
    message?.meta?.kind === "subagent"
      ? getSubagentMessageSessionKey({ message, parentSession })
      : null;
  const subagentPendingCount = useSubagentPendingCount(rowState, subagentSessionKey);
  return (
    <RowLayoutProvider value={layoutRow}>
      <View style={styles.row}>{renderItem(item, isStreaming, subagentPendingCount)}</View>
    </RowLayoutProvider>
  );
});

function renderItem(
  item: AgentChatTranscriptRow | MessagePartItem,
  isStreaming: boolean,
  subagentPendingCount: number,
): ReactElement {
  switch (item.kind) {
    case "message_part":
      return item.look === "reasoning" ? (
        <ReasoningPartRow part={item} />
      ) : (
        <AnswerPartRow part={item} isStreaming={isStreaming} />
      );
    case "turn_duration":
      return <SeparatorRow label={formatTurnDurationLabel(item.durationMs)} />;
    case "fork_boundary":
      return <SeparatorRow label={item.label} accessibilityLabel={`Fork: ${item.label}`} />;
    case "compaction":
      return <CompactionRow row={item} />;
    case "message":
      return (
        <MessageRow
          message={item.message}
          rowKey={item.key}
          isStreaming={isStreaming}
          subagentPendingCount={subagentPendingCount}
        />
      );
  }
}

/** The desktop `MessageBody`: the row of each message kind. */
function MessageRow({
  message,
  rowKey,
  isStreaming,
  subagentPendingCount,
}: {
  message: AgentChatMessage;
  rowKey: string;
  isStreaming: boolean;
  subagentPendingCount: number;
}): ReactElement {
  const { presentToolCall } = useTranscriptRows();
  const row = messageRowKind(message, presentToolCall);
  const timeLabel = messageTimeLabel(message);
  switch (row.kind) {
    case "image":
      return <ImageGenerationRow part={row.meta} rowKey={rowKey} />;
    case "reasoning":
      return <ReasoningRow message={message} rowKey={rowKey} />;
    case "computer_use":
      return (
        <ComputerUseRow
          meta={row.meta}
          messageTimestamp={message.timestamp}
          timeLabel={timeLabel}
          rowKey={rowKey}
        />
      );
    case "task_tool":
      return (
        <TaskToolRow
          meta={row.meta}
          tool={row.taskTool}
          messageContent={message.content}
          messageTimestamp={message.timestamp}
          timeLabel={timeLabel}
          rowKey={rowKey}
        />
      );
    case "workflow_tool":
      return (
        <WorkflowToolRow
          meta={row.meta}
          messageTimestamp={message.timestamp}
          timeLabel={timeLabel}
          displayName={row.displayName}
          document={null}
          rowKey={rowKey}
        />
      );
    case "artifact_tool":
      return (
        <ArtifactToolRow
          meta={row.meta}
          operation={row.operation}
          messageTimestamp={message.timestamp}
          timeLabel={timeLabel}
          displayName={row.displayName}
          rowKey={rowKey}
        />
      );
    case "tool":
      return (
        <ToolCallRow
          meta={row.meta}
          messageContent={message.content}
          messageTimestamp={message.timestamp}
          timeLabel={timeLabel}
          displayName={row.displayName}
          rowKey={rowKey}
        />
      );
    case "subagent":
      return <SubagentRow meta={row.meta} pendingCount={subagentPendingCount} />;
    case "notice":
      return <NoticeRow message={message} meta={row.meta} timeLabel={timeLabel} />;
    case "user":
      return <UserMessageRow message={message} rowKey={rowKey} timeLabel={timeLabel} />;
    case "assistant":
      return <AssistantMessageRow message={message} rowKey={rowKey} isStreaming={isStreaming} />;
    case "system":
      return <SystemRow message={message} rowKey={rowKey} timeLabel={timeLabel} />;
  }
}

const styles = StyleSheet.create((theme) => ({
  // The desktop transcript `px-4`. Wide screens keep a readable line length.
  row: {
    width: "100%",
    maxWidth: theme.layout.readableWidth + 2 * theme.layout.screenPadding,
    alignSelf: "center",
    paddingHorizontal: theme.layout.screenPadding,
  },
}));
