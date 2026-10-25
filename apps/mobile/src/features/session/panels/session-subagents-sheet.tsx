import {
  listSessionSubagents,
  type SessionSubagent,
} from "@openducktor/frontend-core/sessions/session-view/subagent-activity";
import { useAgentSessionVisiblePendingInput } from "@openducktor/frontend-core/sessions/session-store-hooks";
import { formatAgentDuration } from "@openducktor/frontend-core/sessions/transcript/format-agent-duration";
import { useSubagentPendingInputCounts } from "@openducktor/frontend-core/sessions/transcript/subagent-pending-input-counts";
import type {
  AgentChatMessage,
  AgentSessionIdentity,
  AgentSessionState,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import { useRouter } from "expo-router";
import { memo, type ReactElement, useCallback, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { routes, sessionParams } from "@/navigation/routes";
import { useAppTheme } from "@/theme/app-theme-context";
import { sansWeight } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { InPlaceSheet } from "@/ui/in-place-sheet";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { mergePendingCounts } from "../session-transcript-state";
import { useSessionTarget } from "../session-target";
import { useSessionSelector } from "../use-session-selector";
import {
  buildSubagentRows,
  type SubagentRow,
  subagentPillColors,
  subagentsSummaryLabel,
} from "./subagent-rows";

const EMPTY: readonly SessionSubagent[] = Object.freeze([]);
// One list for each messages array, so a store update without new messages costs nothing.
const subagentsByMessages = new WeakMap<readonly AgentChatMessage[], readonly SessionSubagent[]>();

const selectSubagents = (session: AgentSessionState | null): readonly SessionSubagent[] => {
  const messages = session?.messages.items;
  if (!messages) return EMPTY;
  let subagents = subagentsByMessages.get(messages);
  if (!subagents) {
    const listed = listSessionSubagents(messages);
    subagents = listed.length > 0 ? listed : EMPTY;
    subagentsByMessages.set(messages, subagents);
  }
  return subagents;
};

// A Subagent changes only when its message changes, so streaming text keeps the panel still.
const sameSubagents = (
  left: readonly SessionSubagent[],
  right: readonly SessionSubagent[],
): boolean =>
  left.length === right.length &&
  left.every((subagent, index) => subagent.meta === right[index]?.meta);

/** The Subagents of a session with their status and pending input, newest messages first. */
export const useSessionSubagentRows = (identity: AgentSessionIdentity): SubagentRow[] => {
  const subagents = useSessionSelector(identity, selectSubagents, sameSubagents);
  const { pendingApprovals, pendingQuestions } = useAgentSessionVisiblePendingInput(identity);
  // The same counts as the transcript Subagent cards: the child sessions report their own pending
  // input, and the parent can mirror it.
  const pendingCounts = useSubagentPendingInputCounts({
    sessionIdentity: identity,
    pendingApprovals,
    pendingQuestions,
  });
  return useMemo(
    () =>
      buildSubagentRows(
        subagents,
        identity,
        mergePendingCounts(pendingCounts.approvals, pendingCounts.questions),
      ),
    [identity, pendingCounts, subagents],
  );
};

/**
 * The Subagents of the session, which the session menu opens. Selecting a Subagent with a session
 * opens it as a Read-only Session View.
 */
export function SessionSubagentsSheet({
  rows,
  visible,
  onClose,
}: {
  rows: readonly SubagentRow[];
  visible: boolean;
  onClose: () => void;
}): ReactElement {
  const router = useRouter();
  const { workspace } = useSessionTarget();
  const { workspaceId } = workspace;
  const open = useCallback(
    (session: AgentSessionIdentity) => {
      onClose();
      router.push(routes.session({ ...sessionParams(workspaceId, session), readOnly: "1" }));
    },
    [onClose, router, workspaceId],
  );
  return (
    <InPlaceSheet visible={visible} title="Subagents" onClose={onClose}>
      <View style={styles.card} accessibilityLabel={subagentsSummaryLabel(rows)}>
        {rows.map((row, index) => (
          <SubagentRowView key={row.key} row={row} first={index === 0} onOpen={open} />
        ))}
      </View>
    </InPlaceSheet>
  );
}

/**
 * One Subagent, as the desktop `SubagentMessage`: the CPU tile, the name, the status pill, the
 * execution mode, the time, the task, and the failure. A Subagent with a session opens it.
 */
const SubagentRowView = memo(function SubagentRowView({
  row,
  first,
  onOpen,
}: {
  row: SubagentRow;
  first: boolean;
  onOpen: (session: AgentSessionIdentity) => void;
}): ReactElement {
  const theme = useAppTheme();
  const { session } = row;
  const pill = subagentPillColors(theme, row.tone);
  const running = row.tone === "running";
  const durationLabel = row.durationMs === null ? null : formatAgentDuration(row.durationMs);
  const content = (
    <>
      {first ? null : <View style={styles.separator} />}
      <View style={styles.tile}>
        <Icon name="cpu" size={16} colorValue={theme.desktop.pendingAccent} />
      </View>
      <View style={styles.rowText}>
        <View style={styles.rowTitle}>
          <Text variant="callout" weight="semibold" numberOfLines={1} style={styles.name}>
            {row.name}
          </Text>
          <View style={[styles.pill, { borderColor: pill.border, backgroundColor: pill.surface }]}>
            <Text numberOfLines={1} style={[styles.pillText, { color: pill.text }]}>
              {row.statusLabel}
            </Text>
          </View>
          {row.mode ? (
            <View style={[styles.pill, styles.modePill]}>
              <Text numberOfLines={1} style={[styles.pillText, styles.modeText]}>
                {row.mode}
              </Text>
            </View>
          ) : null}
        </View>
        {row.summary ? (
          <Text variant="callout" numberOfLines={2} style={styles.muted}>
            {row.summary}
          </Text>
        ) : null}
        {row.error ? (
          <Text variant="callout" weight="medium" numberOfLines={3} selectable style={styles.error}>
            {row.error}
          </Text>
        ) : null}
        {running || durationLabel || session ? (
          <View style={styles.metaLine}>
            {running ? <LoaderSpinner size={12} color={theme.desktop.mutedForeground} /> : null}
            {durationLabel ? (
              <Text tabular style={styles.meta}>
                {durationLabel}
              </Text>
            ) : null}
            {session ? (
              <View style={styles.sessionLink}>
                <Icon name="eye" size={13} colorValue={theme.desktop.foreground} />
                <Text style={styles.sessionLinkText}>Subagent session</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </>
  );
  if (!session) {
    return (
      <View style={styles.row} accessible accessibilityLabel={row.accessibilityLabel}>
        {content}
      </View>
    );
  }
  return (
    <Touchable
      feedback="highlight"
      onPress={() => onOpen(session)}
      accessibilityRole="button"
      accessibilityLabel={row.accessibilityLabel}
      accessibilityHint="Opens the Subagent session, read only."
      style={styles.row}
    >
      {content}
    </Touchable>
  );
});

const styles = StyleSheet.create((theme) => ({
  // The desktop card look: `rounded-xl border border-input bg-card`.
  card: {
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.input,
    backgroundColor: theme.desktop.card,
    overflow: "hidden",
  },
  row: {
    minHeight: theme.touchTarget,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  separator: {
    position: "absolute",
    top: 0,
    right: 0,
    left: theme.space.md,
    height: theme.hairline,
    backgroundColor: theme.desktop.border,
  },
  tile: {
    padding: theme.space.sm,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.pendingSurface,
  },
  rowText: { flex: 1, minWidth: 0, gap: theme.space.xs },
  rowTitle: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: theme.space.sm },
  name: { flexShrink: 1, color: theme.desktop.foreground },
  pill: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  pillText: {
    ...sansWeight("semibold"),
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  modePill: { borderColor: theme.desktop.border, backgroundColor: theme.desktop.muted },
  modeText: { ...sansWeight("medium"), color: theme.desktop.mutedForeground },
  muted: { color: theme.desktop.mutedForeground },
  error: { color: theme.desktop.destructive },
  metaLine: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  meta: { fontSize: 11, lineHeight: 14, color: theme.desktop.mutedForeground },
  sessionLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginLeft: "auto",
    paddingHorizontal: theme.space.sm,
    height: 24,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.input,
    backgroundColor: theme.desktop.card,
  },
  sessionLinkText: {
    ...sansWeight("medium"),
    fontSize: 12,
    lineHeight: 16,
    color: theme.desktop.foreground,
  },
}));
