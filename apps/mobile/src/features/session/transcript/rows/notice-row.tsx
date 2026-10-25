import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { type AppTheme, sansWeight } from "@/theme/tokens";
import { Text } from "@/ui/text";

type NoticeMeta = Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "session_notice" }>;

/** The desktop `SESSION_NOTICE_TONE_CLASS_NAMES`: the surface, border, and text of each tone. */
const toneColors = (theme: AppTheme, tone: NoticeMeta["tone"]) => {
  const { desktop } = theme;
  switch (tone) {
    case "cancelled":
      return {
        surface: desktop.cancelledSurface,
        border: desktop.cancelledBorder,
        text: desktop.cancelledSurfaceForeground,
      };
    case "error":
      return {
        surface: desktop.destructiveSurface,
        border: desktop.destructiveBorder,
        text: desktop.destructiveSurfaceForeground,
      };
    case "info":
      return {
        surface: desktop.infoSurface,
        border: desktop.infoBorder,
        text: desktop.infoSurfaceForeground,
      };
    case "warning":
      return {
        surface: desktop.warningSurface,
        border: desktop.warningBorder,
        text: desktop.warningSurfaceForeground,
      };
  }
};

/**
 * The desktop `SessionNoticeMessage`: interruption, stop, error, compaction, fork, or runtime
 * policy, as a box in its tone with an uppercase title, the text, and the time at the right.
 */
export const NoticeRow = memo(function NoticeRow({
  message,
  meta,
  timeLabel,
}: {
  message: AgentChatMessage;
  meta: NoticeMeta;
  timeLabel: string;
}): ReactElement {
  const theme = useAppTheme();
  const compacting = meta.reason === "session_compacted" && meta.compactionStatus === "running";
  const colors = toneColors(theme, meta.tone);
  return (
    <View
      style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessible
      accessibilityRole={meta.tone === "error" ? "alert" : "text"}
      accessibilityState={{ busy: compacting }}
    >
      <View style={styles.body}>
        <View style={styles.titleLine}>
          {compacting ? <LoaderSpinner size={12} color={colors.text} /> : null}
          <Text style={[styles.title, { color: colors.text }]}>{meta.title ?? "Notice"}</Text>
        </View>
        {message.content.length > 0 ? (
          <Text selectable style={[styles.text, { color: colors.text }]}>
            {message.content}
          </Text>
        ) : null}
      </View>
      {timeLabel.length > 0 ? (
        <Text style={[styles.time, { color: colors.text }]}>{timeLabel}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  // The desktop article: `my-2 rounded-md border px-3 py-2`.
  box: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.space.md,
    marginVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
  },
  body: { flex: 1, minWidth: 0, gap: theme.space.xs },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 6, opacity: 0.8 },
  title: {
    ...sansWeight("semibold"),
    fontSize: 11.5,
    lineHeight: 16,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  text: { ...sansWeight("regular"), fontSize: 14, lineHeight: 24 },
  time: {
    ...sansWeight("regular"),
    flexShrink: 0,
    fontSize: 11.5,
    lineHeight: 16,
    opacity: 0.7,
    fontVariant: ["tabular-nums"],
  },
}));
