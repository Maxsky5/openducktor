import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { sansWeight } from "@/theme/tokens";
import { Text } from "@/ui/text";
import { type MessagePartItem, messagePartRevision } from "../transcript-message-parts";
import { TranscriptMarkdown } from "./markdown-blocks";

/**
 * The desktop `ReasoningMessage`: a "Thinking:" label, then the reasoning as compact, muted,
 * italic Markdown. It shows only while the device preference Show reasoning is on.
 */
export const ReasoningRow = memo(function ReasoningRow({
  message,
  rowKey,
}: {
  message: AgentChatMessage;
  rowKey: string;
}): ReactElement {
  const streaming = message.meta?.kind === "reasoning" && !message.meta.completed;
  const text = streaming ? message.content || "Thinking…" : message.content;
  return (
    <View style={styles.row} accessibilityState={{ busy: streaming }}>
      <Text style={styles.label}>Thinking:</Text>
      <TranscriptMarkdown
        markdown={text}
        revision={message.id}
        rowKey={rowKey}
        variant="compact"
        muted
        italic
      />
    </View>
  );
});

/**
 * One part of a long reasoning text, as a list row of its own. Together, the parts look as the
 * whole reasoning row: the first part has the label and the top space, and the last part has the
 * bottom space.
 */
export const ReasoningPartRow = memo(function ReasoningPartRow({
  part,
}: {
  part: MessagePartItem;
}): ReactElement {
  const { chunk, previous, message } = part;
  const streaming = message?.meta?.kind === "reasoning" && !message.meta.completed;
  return (
    <View
      style={[
        styles.part,
        previous === null ? styles.firstPart : null,
        message === null ? null : styles.lastPart,
      ]}
      accessibilityState={{ busy: streaming }}
    >
      {previous === null ? <Text style={styles.label}>Thinking:</Text> : null}
      <TranscriptMarkdown
        markdown={chunk.text}
        revision={messagePartRevision(part.messageId, chunk)}
        rowKey={part.key}
        previousMarkdown={previous?.text}
        previousRevision={previous ? messagePartRevision(part.messageId, previous) : undefined}
        variant="compact"
        muted
        italic
      />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  // The desktop `px-1 py-0.5` and `space-y-0.5`.
  row: { paddingHorizontal: theme.space.xs, paddingVertical: 2, gap: 2 },
  part: { paddingHorizontal: theme.space.xs },
  firstPart: { paddingTop: 2, gap: 2 },
  lastPart: { paddingBottom: 2 },
  label: {
    ...sansWeight("medium"),
    fontSize: 11.5,
    lineHeight: 16,
    color: theme.desktop.mutedForeground,
  },
}));
