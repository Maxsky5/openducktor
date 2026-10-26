import type { AgentSessionForkPoint } from "@openducktor/contracts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { isFinalAssistantChatMessage } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/messages";
import { canCopyAssistantMessage } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-kind";
import { getAssistantFooterData } from "@openducktor/frontend-core/sessions/messages/message-formatting";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { runtimeAccentColor } from "@/theme/runtime-accent";
import { sansWeight } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { useSessionFork } from "../../fork/session-fork";
import { type MessagePartItem, messagePartRevision } from "../transcript-message-parts";
import { useTranscriptRows } from "../transcript-rows-context";
import { TranscriptMarkdown } from "./markdown-blocks";
import { CopyControl } from "./row-parts";

/**
 * The Fork action of a completed reply. A blocked fork stays dimmed, and a tap on it says why,
 * as the desktop tooltip does.
 */
function ForkControl({
  point,
  color,
}: {
  point: AgentSessionForkPoint;
  color: string;
}): ReactElement | null {
  const fork = useSessionFork();
  const { feedback } = useClientConnection();
  if (!fork) return null;
  const pending = fork.isPending(point);
  const blocked = fork.disabledReason;
  return (
    <Touchable
      feedback="opacity"
      disabled={pending}
      onPress={() => {
        if (blocked) feedback.show("info", blocked);
        else fork.onFork(point);
      }}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={pending ? "Forking chat" : "Fork from this reply"}
      accessibilityHint={blocked ?? undefined}
      accessibilityState={{ disabled: pending || blocked !== null, busy: pending }}
      style={[styles.action, blocked ? styles.blocked : null]}
    >
      {pending ? (
        <LoaderSpinner size={13} color={color} />
      ) : (
        <Icon name="git-fork" size={13} colorValue={color} />
      )}
    </Touchable>
  );
}

/**
 * The desktop footer of the last message of a turn: a dot in the runtime accent, the model that
 * answered, and then the copy and fork actions of the finished reply.
 */
function AssistantFooter({
  message,
  isStreaming,
}: {
  message: AgentChatMessage;
  isStreaming: boolean;
}): ReactElement | null {
  // A streamed part is not the last message of a turn, so it ends here before any hook runs.
  if (!isFinalAssistantChatMessage(message)) return null;
  return <FinalAssistantFooter message={message} isStreaming={isStreaming} />;
}

/** The last message of a turn, as `isFinalAssistantChatMessage` narrows it. */
type FinalAssistantMessage = AgentChatMessage & {
  role: "assistant";
  meta: Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "assistant" }>;
};

function FinalAssistantFooter({
  message,
  isStreaming,
}: {
  message: FinalAssistantMessage;
  isStreaming: boolean;
}): ReactElement | null {
  const theme = useAppTheme();
  const { runtimeKind, modelCatalog } = useTranscriptRows();
  const copyable = canCopyAssistantMessage(message, isStreaming);
  const footer = getAssistantFooterData(message, runtimeKind, modelCatalog);
  const forkPoint = isStreaming ? undefined : message.meta.forkPoint;
  if (!copyable && forkPoint === undefined && footer.infoParts.length === 0) {
    return null;
  }
  const accent = runtimeAccentColor(theme, runtimeKind);
  const muted = theme.desktop.mutedForeground;
  return (
    <View style={styles.footer}>
      {footer.infoParts.length > 0 ? (
        <View style={styles.info}>
          <View style={[styles.dot, { backgroundColor: accent }]} />
          <Text numberOfLines={1} style={styles.infoText}>
            {footer.infoParts.join(" · ")}
          </Text>
        </View>
      ) : null}
      {copyable ? (
        <CopyControl
          text={message.content}
          what="Message"
          accessibilityLabel="Copy assistant message content"
          color={muted}
        />
      ) : null}
      {forkPoint ? <ForkControl point={forkPoint} color={muted} /> : null}
    </View>
  );
}

/**
 * The desktop `AgentChatAssistantMessage`: full-width document Markdown without a bubble. The last
 * message of a turn ends with the desktop footer.
 */
export const AssistantMessageRow = memo(function AssistantMessageRow({
  message,
  rowKey,
  isStreaming,
}: {
  message: AgentChatMessage;
  rowKey: string;
  isStreaming: boolean;
}): ReactElement {
  return (
    <View style={styles.row} accessibilityState={{ busy: isStreaming }}>
      <TranscriptMarkdown markdown={message.content} revision={message.id} rowKey={rowKey} />
      <AssistantFooter message={message} isStreaming={isStreaming} />
    </View>
  );
});

/**
 * One part of a long answer, as a list row of its own. Together, the parts look as the whole
 * answer row: the first part has its top space, the space between two parts is the space between
 * their blocks, and the last part ends with the footer.
 */
export const AnswerPartRow = memo(function AnswerPartRow({
  part,
  isStreaming,
}: {
  part: MessagePartItem;
  isStreaming: boolean;
}): ReactElement {
  const { chunk, previous, message } = part;
  return (
    <View
      style={[
        styles.part,
        previous === null ? styles.firstPart : null,
        message === null ? null : styles.lastPart,
      ]}
      accessibilityState={{ busy: isStreaming }}
    >
      <TranscriptMarkdown
        markdown={chunk.text}
        revision={messagePartRevision(part.messageId, chunk)}
        rowKey={part.key}
        previousMarkdown={previous?.text}
        previousRevision={previous ? messagePartRevision(part.messageId, previous) : undefined}
      />
      {message === null ? null : <AssistantFooter message={message} isStreaming={isStreaming} />}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  // The desktop article `px-1 pt-1 pb-3` and its `space-y-2`.
  row: {
    paddingHorizontal: theme.space.xs,
    paddingTop: theme.space.xs,
    paddingBottom: theme.space.md,
    gap: theme.space.sm,
  },
  part: { paddingHorizontal: theme.space.xs },
  firstPart: { paddingTop: theme.space.xs },
  lastPart: { paddingBottom: theme.space.md, gap: theme.space.sm },
  // The desktop footer: the model and then its actions, on one line from the start.
  footer: { flexDirection: "row", alignItems: "center", gap: theme.space.xs, minHeight: 20 },
  info: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
    marginRight: 2,
  },
  // `size-1.5 rounded-sm`: the desktop small radius is larger than the dot, so it is round.
  dot: { width: 6, height: 6, borderRadius: 3 },
  infoText: {
    ...sansWeight("regular"),
    flexShrink: 1,
    minWidth: 0,
    fontSize: 12.5,
    lineHeight: 17,
    color: theme.desktop.mutedForeground,
  },
  action: { marginVertical: -4, paddingHorizontal: 4 },
  blocked: { opacity: 0.45 },
}));
