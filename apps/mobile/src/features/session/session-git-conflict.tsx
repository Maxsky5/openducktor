import {
  getGitConflictCopy,
  gitConflictDescription,
} from "@openducktor/frontend-core/git/conflicts/conflict-copy";
import { createGitConflictActionsModel } from "@openducktor/frontend-core/git/conflicts/git-conflict-actions-model";
import type { GitConflict } from "@openducktor/frontend-core/git/contracts";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { useRouter } from "expo-router";
import { type ReactElement, useCallback, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { activeGitConflict } from "@/features/review/conflict-model";
import {
  type GitConflictActions,
  useGitConflictActions,
} from "@/features/review/use-git-conflict-actions";
import {
  type WorkOwner,
  WorkOwnerProvider,
  useWorkOwner,
} from "@/features/work-owner/work-owner-context";
import { readWorkOwnerRef } from "@/features/work-owner/work-owner-params";
import { routes, sessionParams, type WorkOwnerParams } from "@/navigation/routes";
import { useAppTheme } from "@/theme/app-theme-context";
import { useConfirm } from "@/ui/confirm-dialog";
import { Icon } from "@/ui/icon";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { SessionButton } from "./session-button";
import { useSessionTarget } from "./session-target";

const conflictedFilesLabel = (count: number): string =>
  `${count} conflicted file${count === 1 ? "" : "s"}`;

/**
 * Shows a Git Conflict that Git reports for the session work location, as the desktop
 * `GitConflictStrip`: the operation, the conflicted file count, the target branch, View details,
 * Abort, and Ask the agent. View details opens Changes, which lists the conflicted files.
 */
export function SessionGitConflict(): ReactElement | null {
  const { workOwner, readOnly } = useSessionTarget();
  const ownerRef = useMemo(() => (workOwner ? readWorkOwnerRef(workOwner) : null), [workOwner]);
  if (readOnly || !ownerRef || !workOwner) return null;
  return (
    <WorkOwnerProvider ownerRef={ownerRef} diffs>
      <ReadyOwnerConflict params={workOwner} />
    </WorkOwnerProvider>
  );
}

function ReadyOwnerConflict({ params }: { params: WorkOwnerParams }): ReactElement | null {
  const state = useWorkOwner();
  if (state.status !== "ready") return null;
  return <OwnerConflict owner={state.owner} params={params} />;
}

function OwnerConflict({
  owner,
  params,
}: {
  owner: WorkOwner;
  params: WorkOwnerParams;
}): ReactElement | null {
  const router = useRouter();
  const conflict = useMemo(() => activeGitConflict(owner.git.diffData), [owner.git.diffData]);
  const { workspaceId } = owner.workspace;
  const openSession = useCallback(
    (identity: AgentSessionIdentity) =>
      router.push(routes.session(sessionParams(workspaceId, identity))),
    [router, workspaceId],
  );
  const actions = useGitConflictActions({ owner, conflict, onOpenSession: openSession });
  if (!conflict) return null;
  return (
    <ConflictNotice
      conflict={conflict}
      actions={actions}
      recipientLabel={owner.recipientLabel}
      onOpenChanges={() => router.push(routes.changes(params))}
    />
  );
}

function ConflictNotice({
  conflict,
  actions,
  recipientLabel,
  onOpenChanges,
}: {
  conflict: GitConflict;
  actions: GitConflictActions;
  recipientLabel: "Builder" | "agent";
  onOpenChanges: () => void;
}): ReactElement {
  const theme = useAppTheme();
  const confirm = useConfirm();
  const copy = getGitConflictCopy(conflict.operation);
  const model = createGitConflictActionsModel({
    operation: conflict.operation,
    isHandlingConflict: actions.action !== null,
    conflictAction: actions.action,
    onAbort: () => {
      void confirm({
        title: copy.abortLabel,
        message: `This stops the ${copy.operationLabel} and puts the branch back as it was before it.`,
        confirmLabel: copy.abortLabel,
        destructive: true,
      }).then((confirmed) => {
        if (confirmed) void actions.abort();
      });
    },
    onAsk: () => {
      void confirm({
        title: `Ask the ${recipientLabel} to resolve the conflict?`,
        message: actions.askDescription,
        confirmLabel: "Send request",
      }).then((confirmed) => {
        if (confirmed) void actions.askAgent();
      });
    },
    recipientLabel,
    blockedReason: actions.askBlockedReason,
  });
  const { help } = model;
  const count = conflictedFilesLabel(conflict.conflictedFiles.length);
  return (
    <View style={styles.strip} accessibilityRole="summary">
      <View style={styles.top}>
        <View style={styles.badge}>
          <Icon name="triangle-alert" size={16} colorValue={theme.desktop.warningMuted} />
        </View>
        <View style={styles.copy}>
          <View style={styles.titleRow}>
            <Text variant="callout" weight="semibold" style={styles.foreground}>
              {copy.inProgressLabel}
            </Text>
            <View style={styles.countPill}>
              <Text variant="footnote" weight="semibold" style={styles.countText}>
                {count}
              </Text>
            </View>
          </View>
          <Text variant="callout" style={styles.description}>
            {gitConflictDescription(conflict)}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <SessionButton
          label="View details"
          variant="outline"
          accessibilityHint="Lists the conflicted files."
          onPress={onOpenChanges}
        />
        <View style={styles.conflictActions}>
          <SessionButton
            label={model.abort.label}
            icon="rotate-ccw"
            variant="outline"
            command
            loading={model.abort.isPending}
            disabled={model.abort.isDisabled}
            onPress={model.abort.onClick}
          />
          {help ? (
            <SessionButton
              label={help.label}
              icon="sparkles"
              command
              loading={help.isPending}
              disabled={help.isDisabled}
              onPress={help.onClick}
              accessibilityHint={help.blockedReason ?? actions.askDescription}
            />
          ) : null}
        </View>
      </View>
      {help?.blockedReason ? (
        <Text variant="callout" accessibilityRole="text" style={styles.description}>
          {help.blockedReason}
        </Text>
      ) : null}
      {actions.notice ? (
        <Callout
          tone={actions.notice.tone}
          title={actions.notice.title}
          message={actions.notice.message}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // `border-b border-border bg-muted/40 p-2`, as the desktop `GitConflictStrip`.
  strip: {
    gap: theme.space.sm,
    padding: theme.space.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.desktop.border,
    backgroundColor: theme.colors.panelFill,
  },
  top: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.md },
  badge: {
    padding: 10,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.desktop.warningBorder,
    backgroundColor: theme.desktop.warningSurface,
  },
  copy: { flex: 1, minWidth: 0, gap: 6 },
  titleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.space.sm },
  foreground: { color: theme.desktop.foreground },
  countPill: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.desktop.warningBorder,
    backgroundColor: theme.desktop.warningSurface,
  },
  countText: { color: theme.desktop.warningMuted },
  description: { lineHeight: 22, color: theme.desktop.mutedForeground },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.sm,
  },
  conflictActions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
}));
