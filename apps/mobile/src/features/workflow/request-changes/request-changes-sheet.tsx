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
  const { workspaceId, taskId, launch, action, continuation } = useWorkflowSheetParams();
  return (
    <WorkflowSheetFrame title={TITLE} workspaceId={workspaceId} taskId={taskId}>
      {(workspace, id) => (
        <RequestChangesContent
          continuation={continuation}
          workspace={workspace}
          taskId={id}
          launchActionId={launch ?? undefined}
          requestChangesBeforeStart={action === "human_request_changes"}
        />
      )}
    </WorkflowSheetFrame>
  );
}

function RequestChangesContent({
  workspace,
  continuation,
  taskId,
  launchActionId,
  requestChangesBeforeStart,
}: {
  workspace: WorkspaceRecord;
  continuation: TaskWorkflowContinuation | undefined;
  taskId: string;
  launchActionId?: string | undefined;
  requestChangesBeforeStart: boolean;
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
      if (requestChangesBeforeStart) flow.onHumanRequestChanges(task.id, continuation);
      else if (launchActionId) flow.onLaunch(task.id, launchActionId);
      else throw new Error("The feedback launch is missing. Open the task action again.");
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
