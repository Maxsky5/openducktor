import {
  type TaskCloseMergeCheck,
  useMergeStatusDuringCheck,
} from "@openducktor/frontend-core/tasks/approval/use-task-approval-merge-check";
import {
  cleanupTargetLabel,
  TASK_CLOSE_COPY as COPY,
  taskCloseEffectLines,
  uncommittedFilesText,
} from "@openducktor/frontend-core/tasks/details/task-close-copy";
import {
  type TaskCloseImpact,
  type TaskReadState,
  type TaskWorktreeImpact,
  useRemoveWorktreeSettingsRead,
} from "@openducktor/frontend-core/tasks/details/use-task-close-impact";
import type { TaskMergeStatusView } from "@openducktor/frontend-core/tasks/presentation/task-merge-status";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/callout";
import type { CalloutTone } from "@/ui/callout-colors";
import { SwitchCard } from "@/ui/switch-card";
import { Text } from "@/ui/text";

type CleanupChoiceProps = {
  /** Null while the default choice loads. */
  removeWorktree: boolean | null;
  onRemoveWorktreeChange: (removeWorktree: boolean) => void;
  disabled: boolean;
};

/** The merge status, the cleanup choice, and the effects of one task close, as on desktop. */
export function TaskCloseContent({
  impact,
  mergeCheck,
  ...choice
}: CleanupChoiceProps & {
  impact: TaskCloseImpact;
  /** The approval can run a merge check for the workspace. */
  mergeCheck?: TaskCloseMergeCheck | undefined;
}): ReactElement {
  return (
    <View style={styles.content}>
      {impact.mergeStatus ? (
        <TaskCloseMergeStatus status={impact.mergeStatus} mergeCheck={mergeCheck} />
      ) : null}
      <TaskCleanupCard impact={impact} {...choice} />
      <View style={styles.lines}>
        {taskCloseEffectLines(impact).map((line) => (
          <Text key={line} variant="footnote" style={styles.muted}>
            {line}
          </Text>
        ))}
      </View>
      <TaskReadError read={impact} />
    </View>
  );
}

/** The cleanup choice of a close that merges, with the read error that blocks it. */
export function TaskCleanupChoice({
  impact,
  ...choice
}: CleanupChoiceProps & { impact: TaskWorktreeImpact }): ReactElement {
  return (
    <View style={styles.content}>
      <TaskCleanupCard impact={impact} {...choice} />
      <TaskReadError read={impact} />
    </View>
  );
}

/** A failed read blocks its confirmation, so the confirmation shows the error and Retry. */
export function TaskReadError({ read }: { read: TaskReadState }): ReactElement | null {
  if (!read.error) return null;
  return (
    <Callout
      tone="destructive"
      size="sm"
      message={read.error}
      action={
        <Button
          label={COPY.retry}
          size="sm"
          variant="outline"
          disabled={read.isLoading}
          onPress={read.retry}
        />
      }
    />
  );
}

/** The switch with the worktrees and branches that it removes. The rows stay with the choice. */
function TaskCleanupCard({
  impact,
  removeWorktree,
  onRemoveWorktreeChange,
  disabled,
}: CleanupChoiceProps & { impact: TaskWorktreeImpact }): ReactElement {
  // The choice starts from the global setting, so a failed settings read blocks it.
  const settingsRead = useRemoveWorktreeSettingsRead(removeWorktree);
  return (
    <SwitchCard
      label={COPY.removeWorktreeLabel}
      value={removeWorktree === true}
      onValueChange={onRemoveWorktreeChange}
      disabled={disabled || removeWorktree === null}
    >
      <TaskCleanupTargets impact={impact} removes={removeWorktree === true} />
      {settingsRead ? <TaskReadError read={settingsRead} /> : null}
    </SwitchCard>
  );
}

export function TaskCleanupTargets({
  impact,
  removes,
}: {
  impact: TaskWorktreeImpact;
  removes: boolean;
}): ReactElement {
  const theme = useAppTheme();
  const { worktreePaths, branchNames, uncommittedFileCount } = impact;
  if (worktreePaths.length === 0 && branchNames.length === 0) {
    return (
      <Text variant="footnote" style={styles.muted}>
        {COPY.noCleanupTargets}
      </Text>
    );
  }
  return (
    <>
      {worktreePaths.length > 0 ? (
        <CleanupTarget
          label={cleanupTargetLabel("worktree", worktreePaths.length)}
          values={worktreePaths}
        />
      ) : null}
      {branchNames.length > 0 ? (
        <CleanupTarget
          label={cleanupTargetLabel("branch", branchNames.length)}
          values={branchNames}
        />
      ) : null}
      {uncommittedFileCount > 0 ? (
        <View style={styles.target}>
          <Text variant="footnote" style={styles.muted}>
            {COPY.changesLabel}
          </Text>
          {/* Only the color changes with the choice, so the row keeps its size. */}
          <Text
            variant="footnote"
            style={{ color: removes ? theme.desktop.warningMuted : theme.desktop.foreground }}
          >
            {uncommittedFilesText(uncommittedFileCount)}
          </Text>
        </View>
      ) : null}
    </>
  );
}

function CleanupTarget({ label, values }: { label: string; values: string[] }): ReactElement {
  return (
    <View style={styles.target}>
      <Text variant="footnote" style={styles.muted}>
        {label}
      </Text>
      {values.map((value) => (
        <Text key={value} variant="mono" selectable>
          {value}
        </Text>
      ))}
    </View>
  );
}

const MERGE_STATUS_TONES = {
  merged: "success",
  not_merged: "warning",
  not_checked: "info",
  failed: "destructive",
} satisfies Record<TaskMergeStatusView["kind"], CalloutTone>;

function TaskCloseMergeStatus({
  status,
  mergeCheck,
}: {
  status: TaskMergeStatusView;
  mergeCheck: TaskCloseMergeCheck | undefined;
}): ReactElement {
  const { shown, isChecking, checkAgain } = useMergeStatusDuringCheck(status, mergeCheck);
  return (
    <Callout
      tone={MERGE_STATUS_TONES[shown.kind]}
      size="sm"
      message={shown.text}
      detail={mergeCheck?.error ?? shown.detail}
      action={
        mergeCheck ? (
          <Button
            label={COPY.checkAgain}
            size="sm"
            variant="outline"
            loading={isChecking}
            disabled={isChecking}
            onPress={checkAgain}
          />
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { gap: theme.space.md },
  lines: { gap: theme.space.xs },
  muted: { color: theme.desktop.mutedForeground },
  target: { gap: 2 },
}));
