import type { WorkspaceRecord } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  isPullRequestLaunch,
  resolveWorkflowAction,
  type ResolvedTaskCard,
  type WorkflowLaunchActionId as SessionLaunchActionId,
} from "@openducktor/workflows";
import { usePreventRemove } from "expo-router";
import { type ReactElement, useCallback, useState } from "react";
import { useFeedbackStore } from "@/app-shell/app-services";
import type { StartSessionSheetAction } from "@/navigation/routes";
import { useConfirmDiscard } from "@/ui/confirm-discard";
import { EmptyState } from "@/ui/states";
import { useTaskStartFlow } from "../use-task-start-flow";
import { useWorkflowSheetLifecycle } from "../use-workflow-sheet-lifecycle";
import { GroupedSheet } from "@/navigation/grouped-sheet";
import { useWorkflowSheetParams, WorkflowSheetFrame } from "../workflow-sheet-frame";
import { RepoSettingsNotice } from "./repo-settings-notice";
import type { SessionStartModalModel } from "@openducktor/frontend-core/sessions/start/session-start-modal-model";
import { SessionStartSheet } from "./session-start-sheet";

const TITLE = "Start session";

/** A task workflow action, or the session launch action of a desktop quick action. */
type StartRequest =
  | { kind: "action"; action: StartSessionSheetAction }
  | { kind: "launch"; launch: SessionLaunchActionId };

/** The launch that the sheet starts. The sheet cannot collect feedback or run another action. */
const sheetLaunch = (task: ResolvedTaskCard, request: StartRequest) => {
  const operation = request.kind === "action" ? resolveWorkflowAction(task, request.action) : null;
  if (operation && operation.kind !== "session")
    throw new Error(
      "This action does not start a session. Close this sheet and use the task actions.",
    );
  const launch = request.kind === "launch" ? request.launch : operation!.launchActionId;
  const choice = task.taskWorkflow.launchDefinition(launch);
  if (choice.context === "human_feedback")
    throw new Error("Use Request Changes to provide feedback before this session.");
  return { launch };
};

const startRequestOf = (action: string | null, launch: string | null): StartRequest | null =>
  action ? { kind: "action", action } : launch ? { kind: "launch", launch } : null;

/**
 * The start sheet of a task workflow action or a quick action. Its params name the workspace,
 * the task, and the action.
 */
export function StartSessionRoute(): ReactElement {
  const { workspaceId, taskId, action, launch } = useWorkflowSheetParams();
  const request = startRequestOf(action, launch);
  if (!request) {
    return (
      <GroupedSheet title={TITLE}>
        <EmptyState
          icon="link-off"
          title="Action unavailable"
          message="Close this sheet and start the action from the task again."
        />
      </GroupedSheet>
    );
  }
  return (
    <WorkflowSheetFrame title={TITLE} workspaceId={workspaceId} taskId={taskId}>
      {(workspace, id) => (
        <StartSessionContent workspace={workspace} taskId={id} request={request} />
      )}
    </WorkflowSheetFrame>
  );
}

function StartSessionContent({
  workspace,
  taskId,
  request,
}: {
  workspace: WorkspaceRecord;
  taskId: string;
  request: StartRequest;
}): ReactElement {
  const { flow, navigation, tasks, settings, branchesFailure } = useTaskStartFlow(workspace);
  const { feedback } = useFeedbackStore();
  const task = tasks.find((entry) => entry.id === taskId) ?? null;
  const modal = flow.sessionStartModal;

  // The action opens the start choices, or opens an existing session directly. A quick action
  // starts its launch action as the desktop quick actions do.
  const run = () => {
    if (!task) return;
    try {
      const { launch } = sheetLaunch(task, request);
      if (isPullRequestLaunch(launch)) {
        void flow.onPullRequestGenerate(task.id).catch((cause) =>
          feedback.show("error", "The pull request session did not start.", {
            description: errorMessage(cause),
          }),
        );
      } else flow.onLaunch(task.id, launch);
    } catch (cause) {
      feedback.show("error", "The session could not start", { description: errorMessage(cause) });
      navigation.close();
    }
  };
  // The sheet closes when the start choices close.
  useWorkflowSheetLifecycle({
    ready: task !== null,
    run,
    anyOpen: modal?.open === true,
    close: navigation.close,
  });

  const choicesClose = useStartChoicesClose(modal);

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
  if (!modal) {
    return <GroupedSheet title={TITLE} />;
  }
  return (
    <SessionStartSheet
      model={modal}
      blockedReason={settings.blockedReason}
      notice={
        <RepoSettingsNotice
          error={settings.error}
          refreshError={settings.refreshError}
          onRetry={settings.retry}
        />
      }
      branchesFailure={branchesFailure}
      onClose={choicesClose.close}
      onEdit={choicesClose.markEdited}
    />
  );
}

const useStartChoicesClose = (modal: SessionStartModalModel | null) => {
  const confirmDiscard = useConfirmDiscard();
  const [edited, setEdited] = useState(false);
  const markEdited = useCallback(() => setEdited(true), []);
  const asksBeforeClose =
    modal?.phase.kind !== "progress" && edited && modal?.open === true && !modal.isStarting;
  // oxlint-disable-next-line react-compiler/immutability -- usePreventRemove calls back into the close that needs its result; the hook memoizes by hand
  const allowRemoval = usePreventRemove(asksBeforeClose, () => close());
  const close = () => {
    if (!asksBeforeClose) {
      modal?.onOpenChange(false);
      return;
    }
    void confirmDiscard({
      title: "Discard changes?",
      message: "Your choices have not been saved.",
    }).then((confirmed) => {
      if (!confirmed) return;
      allowRemoval();
      modal?.onOpenChange(false);
    });
  };
  return { close, markEdited };
};
