import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { sansWeight } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { useDisclosure } from "./disclosure";
import { TranscriptMarkdown } from "./markdown-blocks";
import { DisclosureMarker, Reveal } from "./row-parts";

type CompactionTranscriptRow = Extract<AgentChatTranscriptRow, { kind: "compaction" }>;

/**
 * The desktop `AgentCompactionSeparator`: a separator with a spinner while the session compacts.
 * A completed compaction with a summary opens it with a press, in a compact Markdown box.
 */
export const CompactionRow = memo(function CompactionRow({
  row,
}: {
  row: CompactionTranscriptRow;
}): ReactElement {
  const theme = useAppTheme();
  const disclosure = useDisclosure(false, `${row.key}:context`);
  const color = theme.desktop.secondaryForeground;
  const running = row.status === "running";
  const label = running ? "Compacting…" : row.label;
  const separator = (
    <>
      <View style={styles.line} />
      <View style={styles.label}>
        {running ? (
          <LoaderSpinner size={14} color={color} />
        ) : (
          <Icon name="shrink" size={14} colorValue={color} />
        )}
        <Text numberOfLines={1} style={styles.text}>
          {label}
        </Text>
        {row.context ? (
          <DisclosureMarker
            open={disclosure.open}
            animated={disclosure.pressed}
            color={color}
            size={14}
          />
        ) : null}
      </View>
      <View style={styles.line} />
    </>
  );
  if (!row.context) {
    return (
      <View style={styles.row} accessible accessibilityRole="text" accessibilityLabel={label}>
        {separator}
      </View>
    );
  }
  return (
    <View>
      <Touchable
        feedback="highlight"
        radius={theme.radius.sm}
        onPress={disclosure.toggle}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: disclosure.open }}
        style={styles.row}
      >
        {separator}
      </Touchable>
      {disclosure.open ? (
        <Reveal animate={disclosure.pressed} style={styles.context}>
          <TranscriptMarkdown
            markdown={row.context}
            revision={`${row.key}:context`}
            rowKey={row.key}
            variant="compact"
          />
        </Reveal>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  // The desktop `AgentTranscriptSeparator`: `flex items-center gap-3 px-1 pt-8 pb-2`.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    paddingHorizontal: theme.space.xs,
    paddingTop: theme.space.xxxl,
    paddingBottom: theme.space.sm,
  },
  line: { flex: 1, height: 1, backgroundColor: theme.desktop.border },
  label: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  text: {
    ...sansWeight("medium"),
    flexShrink: 1,
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: 0.3,
    color: theme.desktop.secondaryForeground,
  },
  // The desktop summary box: `px-1 pb-2` around `rounded-md border border-border bg-card px-3 py-2`.
  context: {
    marginHorizontal: theme.space.xs,
    marginBottom: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
}));
