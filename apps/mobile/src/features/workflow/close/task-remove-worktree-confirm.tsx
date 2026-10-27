import {
  TASK_REMOVE_WORKTREE_COPY as COPY,
  taskRemoveWorktreeConfirmLabel,
  taskRemoveWorktreeDescription,
  taskRemoveWorktreeEffectLines,
} from "@openducktor/frontend-core/tasks/details/task-close-copy";
import type { TaskRemoveWorktreeConfirmDialogModel } from "@openducktor/frontend-core/tasks/details/use-task-remove-worktree-confirm-dialog";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { toFlowFailure } from "@/host-session/command-outcome";
import { Text } from "@/ui/text";
import { TaskConfirmFrame } from "../confirm/task-confirm-view";
import { TaskReadsLoading } from "../confirm/task-reads-loading";
import { TaskCleanupTargets, TaskReadError } from "./task-close-content";

/** Removes the worktree and the local task branch of a closed task, as on desktop. */
export function TaskRemoveWorktreeConfirm({
  dialog,
}: {
  dialog: TaskRemoveWorktreeConfirmDialogModel;
}): ReactElement {
  const { operation, impact } = dialog;
  return (
    <TaskConfirmFrame
      visible={dialog.open}
      title={COPY.title}
      tone="destructive"
      confirm={{
        label: taskRemoveWorktreeConfirmLabel(operation.isPending),
        isBusy: operation.isPending,
        disabled: dialog.confirmDisabled,
      }}
      isPending={operation.isPending}
      failure={
        operation.error
          ? toFlowFailure(operation.error, operation.errorOutcomeUnknown, COPY.failureTitle)
          : null
      }
      icon="folder-x"
      onCancel={dialog.onCancel}
      onConfirm={dialog.onConfirm}
    >
      <Text variant="body" style={styles.muted}>
        {taskRemoveWorktreeDescription(dialog.taskId)}
      </Text>
      {dialog.isPreparing ? (
        <TaskReadsLoading />
      ) : (
        <>
          {/* The close cleanup card shows the same rows. */}
          <View style={styles.targets}>
            <TaskCleanupTargets impact={impact} removes />
          </View>
          <View style={styles.lines}>
            {taskRemoveWorktreeEffectLines(impact).map((line) => (
              <Text key={line} variant="footnote" style={styles.muted}>
                {line}
              </Text>
            ))}
          </View>
          <TaskReadError read={impact} />
        </>
      )}
    </TaskConfirmFrame>
  );
}

const styles = StyleSheet.create((theme) => ({
  muted: { color: theme.desktop.mutedForeground },
  lines: { gap: theme.space.xs },
  targets: {
    gap: theme.space.sm,
    padding: theme.space.md,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
  },
}));
