import {
  TASK_CLOSE_COPY as COPY,
  taskCloseConfirmLabel,
} from "@openducktor/frontend-core/tasks/details/task-close-copy";
import type { TaskCloseConfirmDialogModel } from "@openducktor/frontend-core/tasks/details/use-task-close-confirm-dialog";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { toFlowFailure } from "@/host-session/command-outcome";
import { Text } from "@/ui/text";
import { TaskConfirmFrame } from "../confirm/task-confirm-view";
import { TaskReadsLoading } from "../confirm/task-reads-loading";
import { TaskCloseContent } from "./task-close-content";

/**
 * The Close Task confirmation, as the desktop one: the task, its merge status, the cleanup choice,
 * and what the close stops and keeps. The task ID is selectable, so it can be copied.
 */
export function TaskCloseConfirm({
  dialog,
}: {
  dialog: TaskCloseConfirmDialogModel;
}): ReactElement {
  const { operation, impact } = dialog;
  return (
    <TaskConfirmFrame
      visible={dialog.open}
      title={COPY.title}
      tone="warning"
      confirm={{
        label: taskCloseConfirmLabel(operation.isPending),
        isBusy: operation.isPending,
        disabled: dialog.confirmDisabled,
      }}
      isPending={operation.isPending}
      failure={
        operation.error
          ? toFlowFailure(operation.error, operation.errorOutcomeUnknown, COPY.failureTitle)
          : null
      }
      icon="circle-check-big"
      onCancel={dialog.onCancel}
      onConfirm={dialog.onConfirm}
    >
      <View style={styles.task}>
        {impact.taskTitle ? (
          <Text variant="body" weight="medium" selectable>
            {impact.taskTitle}
          </Text>
        ) : null}
        <Text variant="mono" selectable style={styles.muted}>
          {impact.taskId}
        </Text>
      </View>
      {dialog.isPreparing ? (
        <TaskReadsLoading />
      ) : (
        <TaskCloseContent
          impact={impact}
          removeWorktree={dialog.removeWorktree}
          onRemoveWorktreeChange={dialog.onRemoveWorktreeChange}
          disabled={operation.isPending}
        />
      )}
    </TaskConfirmFrame>
  );
}

const styles = StyleSheet.create((theme) => ({
  muted: { color: theme.desktop.mutedForeground },
  task: { gap: 2 },
}));
