import { resolveInstructionsMessage } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-kind";
import { roleLabel } from "@openducktor/frontend-core/sessions/messages/message-formatting";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { sansWeight } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { TranscriptMarkdown } from "./markdown-blocks";
import { foldsSystemText } from "../transcript-row-type";
import { useTranscriptRows } from "../transcript-rows-context";
import { DetailsBox } from "./row-parts";

/**
 * The desktop `MessageHeader` of a system or thinking message: the role in small uppercase
 * text and the time at the right.
 */
function MessageHeader({
  message,
  timeLabel,
}: {
  message: AgentChatMessage;
  timeLabel: string;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={styles.header}>
      <View style={styles.role}>
        {message.role === "thinking" ? (
          <Icon name="brain" size={12} colorValue={theme.desktop.mutedForeground} />
        ) : null}
        <Text style={styles.roleText}>{roleLabel(message.role, message)}</Text>
      </View>
      {timeLabel.length > 0 ? <Text style={styles.time}>{timeLabel}</Text> : null}
    </View>
  );
}

/**
 * A system message or a thinking message without reasoning parts. An instruction update shows as
 * the desktop `<details>` box that opens compact Markdown, and other OpenCode system text as a box
 * that opens the text. Other messages show as plain text. The mobile transcript leaves out the
 * system prompt.
 */
export const SystemRow = memo(function SystemRow({
  message,
  rowKey,
  timeLabel,
}: {
  message: AgentChatMessage;
  rowKey: string;
  timeLabel: string;
}): ReactElement {
  const theme = useAppTheme();
  const { runtimeKind } = useTranscriptRows();
  const instructions = resolveInstructionsMessage(message, "");
  const folded = foldsSystemText(message, runtimeKind);
  return (
    <View style={instructions || folded ? styles.promptRow : styles.row}>
      <MessageHeader message={message} timeLabel={timeLabel} />
      {instructions ? (
        <DetailsBox
          label={instructions.toggleLabel}
          resetKey={`${rowKey}:instructions`}
          frameStyle={styles.promptFrame}
          textColor={theme.desktop.foreground}
          divided
        >
          <TranscriptMarkdown
            markdown={instructions.markdown}
            revision={`${message.id}:instructions`}
            rowKey={rowKey}
            variant="compact"
          />
        </DetailsBox>
      ) : folded ? (
        <DetailsBox
          label="Show system message"
          resetKey={`${rowKey}:system`}
          frameStyle={styles.promptFrame}
          textColor={theme.desktop.foreground}
          divided
        >
          <Text selectable style={styles.prose}>
            {message.content}
          </Text>
        </DetailsBox>
      ) : (
        <Text selectable style={styles.prose}>
          {message.content}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  // The desktop article of a plain system message: `px-0 py-2`.
  row: { paddingVertical: theme.space.sm },
  promptRow: { paddingVertical: theme.space.xs },
  // The desktop header: `mb-1 flex justify-between gap-2 text-[11px] font-semibold uppercase`.
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.sm,
    marginBottom: theme.space.xs,
  },
  role: { flexDirection: "row", alignItems: "center", gap: theme.space.xs },
  roleText: {
    ...sansWeight("semibold"),
    fontSize: 11.5,
    lineHeight: 16,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: theme.desktop.mutedForeground,
  },
  time: {
    ...sansWeight("regular"),
    fontSize: 11.5,
    lineHeight: 16,
    color: theme.desktop.mutedForeground,
    fontVariant: ["tabular-nums"],
  },
  promptFrame: { borderColor: theme.desktop.border },
  prose: {
    ...sansWeight("regular"),
    fontSize: 15,
    lineHeight: 24,
    color: theme.desktop.foreground,
  },
}));
