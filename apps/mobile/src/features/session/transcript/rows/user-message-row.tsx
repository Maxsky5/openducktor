import {
  buildUserMessageContent,
  type UserMessageContentNode,
  userMessageReferenceLabel,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-user-message-content";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import { memo, type ReactElement, useMemo } from "react";
import { Text as NativeText, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ReferenceChip } from "@/features/session/reference-chip";
import { sansWeight } from "@/theme/tokens";
import { Text } from "@/ui/text";
import { AttachmentPreview } from "./attachment-preview";

type ReferenceNode = Extract<UserMessageContentNode, { kind: "reference" }>;

/** The desktop `renderUserMessageReferenceChip`: a file, skill, or subagent chip in the text. */
function InlineReference({
  node,
  alignWithText,
}: {
  node: ReferenceNode;
  alignWithText: boolean;
}): ReactElement {
  const { part } = node;
  const chip =
    part.kind === "skill_mention" ? (
      <ReferenceChip kind="skill" label={part.skill.name} />
    ) : part.kind === "subagent_reference" ? (
      <ReferenceChip kind="subagent" label={part.subagent.name} />
    ) : (
      <ReferenceChip kind="file" label={part.file.name} fileKind={part.file.kind} />
    );
  return (
    <View
      style={[styles.reference, alignWithText ? styles.referenceWithText : null]}
      accessible
      accessibilityLabel={`Reference ${userMessageReferenceLabel(part)}`}
    >
      {chip}
    </View>
  );
}

/**
 * The desktop user message: a bubble at the trailing edge on the chat surface with a soft
 * shadow and a small corner at the tail. References show as chips in the text and attachments
 * as chips under it. A message that the agent has not read yet has a dashed violet outline and
 * the Unread pill. The time shows under the bubble.
 */
export const UserMessageRow = memo(function UserMessageRow({
  message,
  rowKey,
  timeLabel,
}: {
  message: AgentChatMessage;
  rowKey: string;
  /** The desktop message time, or "" when the history has no exact time. */
  timeLabel: string;
}): ReactElement {
  const { nodes, attachments, isUnread } = useMemo(
    () => buildUserMessageContent(message),
    [message],
  );
  const hasText =
    nodes?.some((node) => node.kind === "text" && node.text.trim().length > 0) ?? false;
  const hasBubble = nodes !== null || attachments.length > 0;
  return (
    <View style={styles.row}>
      {hasBubble ? (
        <View style={[styles.bubble, isUnread ? styles.unreadBubble : styles.readBubble]}>
          {nodes ? (
            <Text selectable style={styles.text}>
              {nodes.map((node) => {
                if (node.kind === "text")
                  return <NativeText key={node.key}>{node.text}</NativeText>;
                if (node.kind === "goal_command")
                  return (
                    <View
                      key={node.key}
                      style={[styles.goal, hasText ? styles.referenceWithText : null]}
                    >
                      <ReferenceChip kind="goal" label="Goal" />
                    </View>
                  );
                return <InlineReference key={node.key} node={node} alignWithText={hasText} />;
              })}
            </Text>
          ) : null}
          {attachments.length > 0 ? (
            <View style={[styles.attachments, nodes ? styles.attachmentsAfterText : null]}>
              {attachments.map((part) => (
                <AttachmentPreview key={part.attachment.id} part={part} rowKey={rowKey} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      <MessageMeta isUnread={isUnread} timeLabel={timeLabel} />
    </View>
  );
});

/** The Unread pill and the time under the bubble, or nothing when the row has neither. */
function MessageMeta({
  isUnread,
  timeLabel,
}: {
  isUnread: boolean;
  timeLabel: string;
}): ReactElement | null {
  if (!isUnread && timeLabel.length === 0) return null;
  return (
    <View style={styles.meta}>
      {isUnread ? (
        <View
          style={styles.unread}
          accessible
          accessibilityLabel="Unread. The agent has not read this message yet."
        >
          <Text style={styles.unreadText}>Unread</Text>
        </View>
      ) : null}
      {timeLabel.length > 0 ? (
        <Text tone="tertiary" style={styles.time}>
          {timeLabel}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  // The desktop row `pt-4` and article `mb-4 ml-auto max-w-[80%] items-end`.
  row: {
    alignItems: "flex-end",
    paddingTop: theme.space.lg,
    paddingBottom: theme.space.lg,
  },
  // The desktop `UserMessageBubble`: `rounded-xl rounded-br-sm px-3.5 py-2 bg-chat-surface
  // shadow-chat`, or a dashed pending outline while the agent has not read the message.
  bubble: {
    maxWidth: "80%",
    borderRadius: theme.radius.xl,
    borderBottomRightRadius: theme.radius.sm,
    borderCurve: "continuous",
    paddingHorizontal: 14,
    paddingVertical: theme.space.sm,
  },
  unreadBubble: {
    backgroundColor: theme.desktop.pendingSurface,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.desktop.pendingBorder,
  },
  readBubble: { backgroundColor: theme.desktop.chatSurface, boxShadow: theme.shadows.raised },
  text: {
    ...sansWeight("regular"),
    fontSize: 15,
    lineHeight: 24,
  },
  reference: { marginHorizontal: theme.space.xs },
  /** The goal chip starts the message, so it has space only after it. */
  goal: { marginRight: theme.space.sm },
  // A 16-point placeholder aligns the 24-point capsule with the 15-point message text.
  // Follow half the 12-point label growth when the system text size changes.
  referenceWithText: { height: 16 + 6 * (rt.fontScale - 1) },
  attachments: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.space.sm,
  },
  attachmentsAfterText: { marginTop: theme.space.sm, marginBottom: theme.space.xs },
  // The desktop `UserMessageMeta`: `mt-1 flex justify-end gap-2 px-1`.
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    marginTop: theme.space.xs,
    paddingHorizontal: theme.space.xs,
  },
  unread: {
    borderWidth: 1,
    borderColor: theme.desktop.pendingBorder,
    backgroundColor: theme.desktop.pendingSurface,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space.sm,
    paddingVertical: 1,
  },
  unreadText: {
    ...sansWeight("semibold"),
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: theme.desktop.pendingSurfaceForeground,
  },
  time: {
    ...sansWeight("medium"),
    fontSize: 11.5,
    lineHeight: 16,
    fontVariant: ["tabular-nums"],
  },
}));
