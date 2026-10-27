import type { WorkspaceRecord } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  BUILTIN_LAUNCH_ACTION_IDS,
  getSessionLaunchAction,
  type BuiltinLaunchActionId as SessionLaunchActionId,
} from "@openducktor/workflows";
import type { UseTaskSessionStartFlowResult } from "@openducktor/frontend-core/tasks/workflow/use-task-session-start-flow";
import { usePreventRemove } from "expo-router";
import { type ReactElement, useCallback, useState } from "react";
import { useFeedbackStore } from "@/app-shell/app-services";
import type { StartSessionSheetAction } from "@/navigation/routes";
import { useConfirmDiscard } from "@/ui/confirm-discard";
import { EmptyState, LoadingState } from "@/ui/states";
import { useTaskStartFlow } from "../use-task-start-flow";
import { useWorkflowSheetLifecycle } from "../use-workflow-sheet-lifecycle";
import { GroupedSheet } from "@/navigation/grouped-sheet";
import { useWorkflowSheetParams, WorkflowSheetFrame } from "../workflow-sheet-frame";
import { RepoSettingsFailure } from "./repo-settings-failure";
import type { ClientFeedback } from "@openducktor/frontend-core/platform/client-feedback";
import type { SessionStartModalModel } from "@openducktor/frontend-core/sessions/start/session-start-modal-model";
import { SessionStartSheet } from "./session-start-sheet";

const TITLE = "Start Session";

/** The flow call of each start action. The type makes a new action add its call here. */
const START_ACTIONS = {
  set_spec: (flow, taskId) => flow.onPlan(taskId, "set_spec"),
  set_plan: (flow, taskId) => flow.onPlan(taskId, "set_plan"),
  build_start: (flow, taskId) => flow.onDelegate(taskId),
  qa_start: (flow, taskId) => flow.onQaStart(taskId),
} satisfies Record<
  StartSessionSheetAction,
  (flow: UseTaskSessionStartFlowResult, taskId: string) => void
>;
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
          title="Unknown Action"
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

const isStartAction = (value: string | null): value is StartSessionSheetAction =>
  value !== null && Object.hasOwn(START_ACTIONS, value);
const isLaunchAction = (value: string | null): value is SessionLaunchActionId =>
  BUILTIN_LAUNCH_ACTION_IDS.some((launch) => launch === value);

/** A task workflow action, or the session launch action of a desktop quick action. */
type StartRequest =
  | { kind: "action"; action: StartSessionSheetAction }
  | { kind: "launch"; launch: SessionLaunchActionId };

const startRequestOf = (action: string | null, launch: string | null): StartRequest | null => {
  if (isStartAction(action)) return { kind: "action", action };
  if (isLaunchAction(launch)) return { kind: "launch", launch };
  return null;
};

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
    if (task) runStartRequest(request, task.id, flow, feedback);
  };
  // The sheet closes when the start choices close.
  const triggered = useWorkflowSheetLifecycle({
    ready: task !== null && settings.ready && settings.error === null,
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
          title="Task Not Found"
          message={`${taskId} is no longer in this workspace.`}
        />
      </GroupedSheet>
    );
  }
  if (settings.error && !triggered) {
    return (
      <GroupedSheet title={TITLE}>
        <RepoSettingsFailure message={settings.error} onRetry={settings.retry} />
      </GroupedSheet>
    );
  }
  if (!modal) {
    return (
      <GroupedSheet title={TITLE}>
        <LoadingState label="Preparing the session start" />
      </GroupedSheet>
    );
  }
  return (
    <SessionStartSheet
      model={modal}
      branchesFailure={branchesFailure}
      onClose={choicesClose.close}
      onEdit={choicesClose.markEdited}
    />
  );
}

const runStartRequest = (
  request: StartRequest,
  taskId: string,
  flow: UseTaskSessionStartFlowResult,
  feedback: ClientFeedback,
): void => {
  if (request.kind === "action") {
    START_ACTIONS[request.action](flow, taskId);
    return;
  }
  const { launch } = request;
  if (launch === "build_pull_request_generation") {
    flow.onPullRequestGenerate(taskId).catch((cause: unknown) =>
      feedback.show("error", "The pull request session did not start.", {
        description: errorMessage(cause),
      }),
    );
    return;
  }
  void flow.startSessionIntent({
    taskId,
    role: getSessionLaunchAction(launch).role,
    launchActionId: launch,
    postStartAction: "kickoff",
  });
};

const useStartChoicesClose = (modal: SessionStartModalModel | null) => {
  const confirmDiscard = useConfirmDiscard();
  const [edited, setEdited] = useState(false);
  const markEdited = useCallback(() => setEdited(true), []);
  const asksBeforeClose =
    modal?.phase.kind !== "progress" && edited && modal?.open === true && !modal.isStarting;
  const allowRemoval = usePreventRemove(asksBeforeClose, () => close());
  const close = () => {
    if (!asksBeforeClose) {
      modal?.onOpenChange(false);
      return;
    }
    void confirmDiscard({
      title: "Discard the Session Start?",
      message: "Your choices are not saved.",
    }).then((confirmed) => {
      if (!confirmed) return;
      allowRemoval();
      modal?.onOpenChange(false);
    });
  };
  return { close, markEdited };
};
