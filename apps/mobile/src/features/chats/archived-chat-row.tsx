import type { WorkspaceSession } from "@openducktor/contracts";
import {
  isOutcomeUnknown,
  RESULT_UNKNOWN_TITLE,
} from "@openducktor/frontend-core/lib/command-outcome";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { workspaceSessionTitle } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import {
  ARCHIVED_CHATS_TEXT,
  isArchivedWorktreeRemoved,
  workspaceSessionRoleName,
} from "@openducktor/frontend-core/workspace-sessions/archived-workspace-sessions";
import { memo, type ReactElement, useCallback } from "react";
import { type DimensionValue, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { RuntimeIcon } from "@/ui/brand-icons";
import { Button, ButtonPlaceholder } from "@/ui/button";
import { TextPlaceholder } from "@/ui/placeholders";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";

/**
 * One archived chat as the desktop archived chat card: the title, the role and folder, a note when
 * the archive removed the worktree, and Restore.
 */
export const ArchivedChatRow = memo(function ArchivedChatRow({
  record,
  restoring,
  busy,
  failure,
  onRestore,
}: {
  record: WorkspaceSession;
  restoring: boolean;
  /** True while any restore or a list read runs, as on desktop. */
  busy: boolean;
  failure: Error | null;
  onRestore: (record: WorkspaceSession) => void;
}): ReactElement {
  const title = workspaceSessionTitle(record);
  const unknown = failure !== null && isOutcomeUnknown(failure);
  const restore = useCallback(() => onRestore(record), [onRestore, record]);
  return (
    <View style={styles.cell}>
      <View style={styles.card}>
        <View style={styles.body}>
          <Text numberOfLines={2} style={styles.title}>
            {title}
          </Text>
          <View style={styles.detail}>
            <RuntimeIcon runtimeKind={record.runtimeKind} size={13} />
            <Text numberOfLines={1} ellipsizeMode="middle" style={styles.detailText}>
              {workspaceSessionRoleName(record)} · {record.executionTarget.workingDirectory}
            </Text>
          </View>
          {isArchivedWorktreeRemoved(record) ? (
            <Text style={styles.detailText}>{ARCHIVED_CHATS_TEXT.worktreeRemoved}</Text>
          ) : null}
        </View>
        <Button
          label={ARCHIVED_CHATS_TEXT.restore}
          icon="rotate-ccw"
          size="sm"
          variant="outline"
          command
          loading={restoring}
          disabled={busy}
          accessibilityLabel={`Restore ${title}`}
          onPress={restore}
        />
      </View>
      {failure ? (
        <View style={styles.failure}>
          <Callout
            tone={unknown ? "warning" : "destructive"}
            title={unknown ? RESULT_UNKNOWN_TITLE : "The chat was not restored"}
            message={errorMessage(failure)}
          />
        </View>
      ) : null}
    </View>
  );
});

/**
 * An archived chat for a first load: the card, bars in place of the title and of the runtime and
 * folder line, and the Restore button. It uses the row styles, so the loaded list takes its exact
 * place.
 */
export function ArchivedChatRowPlaceholder({
  titleWidth,
  detailWidth,
}: {
  titleWidth: DimensionValue;
  detailWidth: DimensionValue;
}): ReactElement {
  return (
    <View style={styles.cell}>
      <View style={styles.card}>
        <View style={styles.body}>
          <TextPlaceholder width={titleWidth} />
          <View style={styles.detail}>
            <View style={styles.placeholderIcon} />
            <TextPlaceholder variant="footnote" width={detailWidth} style={styles.fill} />
          </View>
        </View>
        {/* The width of "Restore" with its icon. */}
        <ButtonPlaceholder size="sm" width={95} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  cell: { paddingHorizontal: theme.layout.screenPadding, paddingVertical: 4 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
    boxShadow: theme.shadows.card,
  },
  body: { flex: 1, minWidth: 0, gap: 3 },
  title: {
    ...theme.type.body,
    fontFamily: theme.fonts.sans.medium,
    fontWeight: "500",
    color: theme.desktop.foreground,
  },
  detail: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  detailText: { ...theme.type.footnote, flexShrink: 1, color: theme.desktop.mutedForeground },
  failure: { paddingTop: theme.space.sm },
  fill: { flex: 1 },
  placeholderIcon: { width: 13, height: 13, borderRadius: 4, backgroundColor: theme.colors.fill },
}));
