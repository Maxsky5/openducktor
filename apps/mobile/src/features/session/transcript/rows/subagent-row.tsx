import type { SubagentMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { toSubagentSessionIdentity } from "@openducktor/frontend-core/sessions/transcript/subagent-session-key";
import { memo, type ReactElement, useCallback, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { describeSubagent, subagentPillColors } from "@/features/session/panels/subagent-rows";
import { useAppTheme } from "@/theme/app-theme-context";
import { sansWeight, touchSlop } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { useTranscriptRows } from "../transcript-rows-context";
import { StatusPill, ToolTiming } from "./row-parts";

const NO_TIME_LABEL = "";
/** The desktop `h-6` outline button, a little taller for a finger. Large text makes it grow. */
const SESSION_BUTTON_HEIGHT = 30;

/**
 * The desktop `SubagentMessage`: a card with the Cpu tile, the agent name, its status and
 * execution mode pills, the timing, its task and failure, and the "Subagent session" button,
 * which opens the Read-only Session View of the Subagent.
 */
export const SubagentRow = memo(function SubagentRow({
  meta,
  pendingCount,
}: {
  meta: SubagentMeta;
  pendingCount: number;
}): ReactElement {
  const theme = useAppTheme();
  const { parentSession, onOpenSubagent } = useTranscriptRows();
  const identity = useMemo(
    () => toSubagentSessionIdentity({ externalSessionId: meta.externalSessionId, parentSession }),
    [meta.externalSessionId, parentSession],
  );
  const open = useCallback(() => {
    if (identity) onOpenSubagent(identity);
  }, [identity, onOpenSubagent]);
  const subagent = describeSubagent(meta, identity, pendingCount);
  const pill = subagentPillColors(theme, subagent.tone);
  return (
    <View style={styles.card}>
      <View style={styles.main} accessible accessibilityLabel={subagent.accessibilityLabel}>
        <View style={styles.tile}>
          <Icon name="cpu" size={16} colorValue={theme.desktop.pendingAccent} />
        </View>
        <View style={styles.body}>
          {/* The name and its pills share one line, so the card stays short. */}
          <View style={styles.titleLine}>
            <Text numberOfLines={1} style={styles.name}>
              {subagent.name}
            </Text>
            <StatusPill
              label={subagent.statusLabel}
              surface={pill.surface}
              border={pill.border}
              text={pill.text}
            />
            {subagent.mode ? (
              <StatusPill
                label={subagent.mode}
                surface={theme.desktop.muted}
                border={theme.desktop.border}
                text={theme.desktop.mutedForeground}
                weight="medium"
              />
            ) : null}
            {/* A phone has no room for the clock time on this line, so it shows the duration. */}
            <View style={styles.timing}>
              <ToolTiming
                active={subagent.tone === "running"}
                durationMs={subagent.durationMs}
                timeLabel={NO_TIME_LABEL}
              />
            </View>
          </View>
          {subagent.summary ? (
            <Text numberOfLines={2} style={styles.summary}>
              {subagent.summary}
            </Text>
          ) : null}
          {subagent.error ? (
            <Text selectable style={styles.error}>
              {subagent.error}
            </Text>
          ) : null}
        </View>
      </View>
      {identity ? (
        <Touchable
          feedback="scale"
          radius={theme.radius.md}
          onPress={open}
          // The touch area reaches the platform touch target around the short button.
          hitSlop={touchSlop(SESSION_BUTTON_HEIGHT)}
          accessibilityRole="button"
          accessibilityLabel="View subagent session"
          accessibilityHint="Opens the Subagent session to read."
          style={styles.button}
        >
          <Icon name="eye" size={14} colorValue={theme.desktop.foreground} />
          <Text style={styles.buttonText}>Subagent session</Text>
        </Touchable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  // The desktop article: `rounded-md border border-border bg-card px-3 py-2 shadow-sm my-2`.
  card: {
    marginVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    gap: theme.space.sm,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
    boxShadow: theme.shadows.card,
  },
  main: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.md },
  // The desktop tile: `rounded-md border border-border bg-pending-surface p-2`.
  tile: {
    padding: theme.space.sm,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.pendingSurface,
  },
  body: { flex: 1, minWidth: 0, gap: theme.space.xs },
  titleLine: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, minHeight: 20 },
  timing: { flex: 1, alignItems: "flex-end" },
  name: {
    ...sansWeight("semibold"),
    flexShrink: 1,
    fontSize: 15,
    lineHeight: 20,
    color: theme.desktop.foreground,
  },
  summary: {
    ...sansWeight("regular"),
    fontSize: 14,
    lineHeight: 20,
    color: theme.desktop.mutedForeground,
  },
  error: {
    ...sansWeight("medium"),
    fontSize: 14,
    lineHeight: 20,
    color: theme.desktop.destructive,
  },
  // The desktop outline `xs` button: `h-6 rounded-md px-2 text-xs border border-input bg-card`.
  button: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    gap: 6,
    minHeight: SESSION_BUTTON_HEIGHT,
    paddingHorizontal: theme.space.sm,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.input,
    backgroundColor: theme.desktop.card,
  },
  buttonText: {
    ...sansWeight("medium"),
    fontSize: 13,
    lineHeight: 18,
    color: theme.desktop.foreground,
  },
}));
