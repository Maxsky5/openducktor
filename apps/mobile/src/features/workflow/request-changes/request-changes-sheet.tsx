import type { WorkspaceRecord } from "@openducktor/contracts";
import {
  HUMAN_REVIEW_FEEDBACK_COPY as COPY,
  isHumanReviewFeedbackConfirmDisabled,
} from "@openducktor/frontend-core/tasks/workflow/human-review-feedback-state";
import { usePreventRemove } from "expo-router";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/ui/button";
import { useConfirmDiscard } from "@/ui/confirm-discard";
import { EmptyState } from "@/ui/states";
import { Text } from "@/ui/text";
import { ActionForm } from "@/ui/action-form";
import { FormBody, FormLead } from "@/ui/form-rows";
import { RepoSettingsNotice } from "../start-session/repo-settings-notice";
import { SessionStartSheet } from "../start-session/session-start-sheet";
import { useTaskStartFlow } from "../use-task-start-flow";
import { useWorkflowSheetLifecycle } from "../use-workflow-sheet-lifecycle";
import { requestChangesRemove } from "./request-changes-remove";
import { RequestChangesFeedbackField } from "./request-changes-feedback-field";
import { GroupedSheet } from "@/navigation/grouped-sheet";
import { useWorkflowSheetParams, WorkflowSheetFrame } from "../workflow-sheet-frame";

const TITLE = "Request changes";

/**
 * Request Changes: the feedback for the Builder, then the session start choices of the Builder
 * session that receives it.
 */
export function RequestChangesRoute(): ReactElement {
  const { workspaceId, taskId } = useWorkflowSheetParams();
  return (
    <WorkflowSheetFrame title={TITLE} workspaceId={workspaceId} taskId={taskId}>
      {(workspace, id) => <RequestChangesContent workspace={workspace} taskId={id} />}
    </WorkflowSheetFrame>
  );
}

function RequestChangesContent({
  workspace,
  taskId,
}: {
  workspace: WorkspaceRecord;
  taskId: string;
}): ReactElement {
  const { flow, navigation, tasks, settings, branchesFailure, backgroundAttemptId } =
    useTaskStartFlow(workspace);
  const confirmDiscard = useConfirmDiscard();
  const task = tasks.find((entry) => entry.id === taskId) ?? null;
  const feedback = flow.humanReviewFeedbackModal;
  const start = flow.sessionStartModal;
  // The sheet closes when neither step is open: after a start that stays, or a cancel.
  useWorkflowSheetLifecycle({
    ready: task !== null,
    run: () => {
      if (task) flow.onHumanRequestChanges(task.id);
    },
    anyOpen: feedback !== null || start?.open === true,
    close: navigation.close,
  });

  // Cancel, Android back, and the swipe gesture ask before they drop typed feedback.
  const remove = requestChangesRemove(feedback, start, backgroundAttemptId !== null);
  const hasUnsentFeedback = remove === "confirm_discard";
  const discardFeedback = () => {
    void confirmDiscard({
      title: "Discard feedback?",
      message: "Your feedback has not been sent.",
    }).then((confirmed) => {
      if (confirmed) feedback?.onOpenChange(false);
    });
  };
  usePreventRemove(remove !== "leave", () => {
    if (remove === "back_to_feedback") start?.onOpenChange(false);
    else discardFeedback();
  });

  if (!task) {
    return (
      <GroupedSheet title={TITLE}>
        <EmptyState
          icon="search-x"
          title="Task not found"
          message={`${taskId} is no longer in this workspace.`}
        />
      </GroupedSheet>
    );
  }
  if (start?.open) {
    return (
      <SessionStartSheet
        model={start}
        blockedReason={settings.blockedReason}
        branchesFailure={branchesFailure}
        notice={
          <RepoSettingsNotice
            error={settings.error}
            refreshError={settings.refreshError}
            onRetry={settings.retry}
          />
        }
      />
    );
  }
  if (!feedback) {
    return <GroupedSheet title={TITLE} />;
  }
  const submitBlocked = isHumanReviewFeedbackConfirmDisabled(feedback);
  return (
    <GroupedSheet
      title={COPY.title}
      onClose={hasUnsentFeedback ? discardFeedback : () => feedback.onOpenChange(false)}
      closable={!feedback.isSubmitting}
    >
      <ActionForm
        note={
          submitBlocked && !feedback.isSubmitting ? "Write your feedback to request changes." : null
        }
        primary={
          <Button
            label={COPY.confirmLabel}
            size="lg"
            loading={feedback.isSubmitting}
            icon="message-square-warning"
            disabled={submitBlocked}
            onPress={() => void feedback.onConfirm()}
            fill
          />
        }
      >
        <FormBody>
          <RepoSettingsNotice
            error={settings.error}
            refreshError={settings.refreshError}
            onRetry={settings.retry}
          />
          <View style={styles.lead}>
            <FormLead text={COPY.description} />
            <Text variant="footnote" tone="secondary" numberOfLines={2}>
              <Text variant="monoSmall" tone="secondary">
                {task.id}
              </Text>
              {`  ${task.title}`}
            </Text>
          </View>
          <RequestChangesFeedbackField
            value={feedback.message}
            onChangeText={feedback.onMessageChange}
            editable={!feedback.isSubmitting}
          />
        </FormBody>
      </ActionForm>
    </GroupedSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  lead: { gap: theme.space.sm },
}));
