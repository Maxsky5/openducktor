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
import { TaskCloseContent } from "./task-close-content";

/**
 * The Close Task confirmation, as the desktop one: the task, its merge status, the cleanup choice,
 * and what the close stops and keeps. The task ID is selectable, so it can be copied.
 */
export function TaskCloseConfirm({
  dialog,
  onDismiss,
}: {
  dialog: TaskCloseConfirmDialogModel;
  onDismiss?: (() => void) | undefined;
}): ReactElement {
  const { operation, impact } = dialog;
  return (
    <TaskConfirmFrame
      visible={dialog.open}
      title={COPY.title}
      intro={
        <View style={styles.task}>
          <Text variant="subhead" tone="secondary">
            {COPY.description}
          </Text>
          {impact.taskTitle ? (
            <Text variant="headline" numberOfLines={2} selectable>
              {impact.taskTitle}
            </Text>
          ) : null}
          <Text variant="caption2" tone="tertiary" selectable>
            {impact.taskId}
          </Text>
        </View>
      }
      tone="warning"
      confirm={{
        label: taskCloseConfirmLabel(operation.isPending),
        isBusy: operation.isPending,
        disabled: dialog.confirmDisabled,
      }}
      isPending={operation.isPending}
      loading={dialog.isPreparing}
      failure={
        operation.error
          ? toFlowFailure(operation.error, operation.errorOutcomeUnknown, COPY.failureTitle)
          : null
      }
      icon="circle-check-big"
      onCancel={dialog.onCancel}
      onDismiss={onDismiss}
      onConfirm={dialog.onConfirm}
    >
      <TaskCloseContent
        impact={impact}
        removeWorktree={dialog.removeWorktree}
        onRemoveWorktreeChange={dialog.onRemoveWorktreeChange}
        disabled={operation.isPending}
      />
    </TaskConfirmFrame>
  );
}

const styles = StyleSheet.create({
  task: { gap: 2 },
});
