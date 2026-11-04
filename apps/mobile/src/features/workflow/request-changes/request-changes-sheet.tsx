import type { HumanReviewFeedbackRequest } from "@openducktor/frontend-core/tasks/workflow/human-review-feedback-types";
import { HumanFeedbackSheet, useFeedbackSheetClose } from "./human-feedback-sheet";
import type { TaskWorkflowContinuation } from "@openducktor/frontend-core/tasks/workflow/task-workflow-continuation";
import type { WorkspaceRecord } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { EmptyState } from "@/ui/states";
import { RepoSettingsNotice } from "../start-session/repo-settings-notice";
import { SessionStartSheet } from "../start-session/session-start-sheet";
import { useTaskStartFlow } from "../use-task-start-flow";
import { useWorkflowSheetLifecycle } from "../use-workflow-sheet-lifecycle";
import { GroupedSheet } from "@/navigation/grouped-sheet";
import { useWorkflowSheetParams, WorkflowSheetFrame } from "../workflow-sheet-frame";

const TITLE = "Request changes";

/**
 * Request Changes: the feedback for the Builder, then the session start choices of the Builder
 * session that receives it.
 */
export function RequestChangesRoute(): ReactElement {
  const { workspaceId, taskId, mode, launch, continuation } = useWorkflowSheetParams();
  const request = feedbackRequest(mode, launch, continuation);
  return (
    <WorkflowSheetFrame title={TITLE} workspaceId={workspaceId} taskId={taskId}>
      {(workspace, id) => (
        <RequestChangesContent workspace={workspace} taskId={id} request={request} />
      )}
    </WorkflowSheetFrame>
  );
}

/** The feedback request of the route params. A link without a valid mode has none. */
const feedbackRequest = (
  mode: string | null,
  launch: string | null,
  continuation: TaskWorkflowContinuation | undefined,
): HumanReviewFeedbackRequest | null => {
  if (mode === "request_changes") return { kind: "request_changes", continuation };
  if (mode === "launch" && launch) return { kind: "launch", launchActionId: launch };
  return null;
};

function RequestChangesContent({
  workspace,
  taskId,
  request,
}: {
  workspace: WorkspaceRecord;
  taskId: string;
  request: HumanReviewFeedbackRequest | null;
}): ReactElement {
  const { flow, navigation, tasks, settings, branchesFailure, backgroundAttemptId } =
    useTaskStartFlow(workspace);
  const task = tasks.find((entry) => entry.id === taskId) ?? null;
  const feedback = flow.humanReviewFeedbackModal;
  const start = flow.sessionStartModal;
  const closeFeedback = useFeedbackSheetClose(feedback, start, backgroundAttemptId !== null);
  // The sheet closes when neither step is open: after a start that stays, or a cancel.
  useWorkflowSheetLifecycle({
    ready: task !== null,
    run: () => {
      if (!task) return;
      if (!request) throw new Error("The feedback action is missing. Open the task action again.");
      if (request.kind === "request_changes")
        flow.onHumanRequestChanges(task.id, request.continuation);
      else flow.onLaunch(task.id, request.launchActionId);
    },
    anyOpen: feedback !== null || start?.open === true,
    close: navigation.close,
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
  return <HumanFeedbackSheet task={task} feedback={feedback} onClose={closeFeedback} />;
}
