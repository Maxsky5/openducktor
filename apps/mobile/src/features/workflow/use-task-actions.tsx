import type { TaskCard, WorkspaceRecord } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import {
  TasksStateContext,
  useRequiredContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import type { TaskWorkflowAction } from "@openducktor/frontend-core/tasks/board/kanban-task-workflow";
import type { SessionTargetOptions } from "@openducktor/frontend-core/tasks/board/session-target-resolution";
import { useTaskResetFlow } from "@openducktor/frontend-core/tasks/workflow/use-task-reset-flow";
import { useRouter } from "expo-router";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { routes, SINGLE_SHEET, sessionParams } from "@/navigation/routes";
import {
  ResetImplementationConfirmation,
  TaskConfirmations,
  type TaskConfirmationRequest,
} from "./confirm/task-confirmations";
import {
  type ConfirmationOutcomeListener,
  useConfirmationOutcome,
} from "./confirm/use-confirmation-outcome";
import {
  resolveTaskActionDestination,
  showNoSession,
  type TaskConfirmationAction,
} from "./task-action-routing";

export type TaskActions = {
  /** Runs a workflow action of a task. `sessionOptionsOf` names the session of each role. */
  runAction: (
    task: TaskCard,
    action: TaskWorkflowAction,
    sessionOptionsOf: (role: AgentRole) => SessionTargetOptions | undefined,
  ) => void;
  openSession: (task: TaskCard, role: AgentRole, options: SessionTargetOptions) => void;
  /** Asks for the confirmation of an action that has no workflow action ID, such as Delete. */
  confirm: (task: TaskCard, action: TaskConfirmationAction) => void;
  /** The confirmation of the current request. Render it once on the screen. */
  confirmations: ReactElement;
};

/** A confirmed action of a task. */
export type ConfirmedTaskAction = { taskId: string; action: TaskConfirmationAction };

/**
 * The task workflow actions of one workspace on the board or the task details. Session starts,
 * approval, and Request Changes open their sheets. Reset and Close ask for confirmation here.
 * `outcome` hears about each confirmed action, for example a Delete from the task details.
 */
export function useTaskActions({
  workspace,
  tasks,
  outcome = NO_OUTCOME_LISTENER,
}: {
  workspace: WorkspaceRecord;
  tasks: TaskCard[];
  outcome?: ConfirmationOutcomeListener<ConfirmedTaskAction> | undefined;
}): TaskActions {
  const router = useRouter();
  const { feedback } = useClientConnection();
  const { resetTaskImplementation } = useRequiredContext(TasksStateContext, "useTaskActions");
  const { workspaceId, repoPath } = workspace;
  const [request, setRequest] = useState<TaskConfirmationRequest | null>(null);
  const nextRequestId = useRef(0);
  const workspaceIdentity = useMemo(() => ({ workspaceId, repoPath }), [repoPath, workspaceId]);
  const { resetImplementationModal, openResetImplementation } = useTaskResetFlow({
    tasks,
    workspaceIdentity,
    resetTaskImplementation,
    closeTaskDetails: (taskId) => outcome.onSucceeded?.({ taskId, action: "reset_implementation" }),
  });
  // The reset flow makes a new opener for each task list. Confirm reads the latest one, so the
  // board rows keep their action handlers when a task changes.
  const openReset = useRef(openResetImplementation);
  useEffect(() => {
    openReset.current = openResetImplementation;
  }, [openResetImplementation]);

  const confirm = useCallback((task: TaskCard, action: TaskConfirmationAction) => {
    if (action === "reset_implementation") {
      openReset.current(task.id, { closeDetailsAfterReset: true });
      return;
    }
    nextRequestId.current += 1;
    setRequest({ id: nextRequestId.current, taskId: task.id, action });
  }, []);

  const openSession = useCallback(
    (_task: TaskCard, _role: AgentRole, options: SessionTargetOptions) => {
      router.push(routes.session(sessionParams(workspaceId, options.session)));
    },
    [router, workspaceId],
  );

  const runAction = useCallback<TaskActions["runAction"]>(
    (task, action, sessionOptionsOf) => {
      const destination = resolveTaskActionDestination(action, task.id, sessionOptionsOf);
      if (!destination) return;
      switch (destination.kind) {
        case "start_session":
          router.push(routes.startSession(workspaceId, task.id, destination.action), SINGLE_SHEET);
          return;
        case "open_session":
          openSession(task, destination.role, destination.options);
          return;
        case "no_session":
          showNoSession(feedback, task.id, destination.role);
          return;
        case "approve":
          router.push(routes.approveTask(workspaceId, task.id), SINGLE_SHEET);
          return;
        case "request_changes":
          router.push(routes.requestChanges(workspaceId, task.id), SINGLE_SHEET);
          return;
        case "confirm":
          confirm(task, destination.action);
          return;
      }
    },
    [confirm, feedback, openSession, router, workspaceId],
  );

  // A Delete from the task details pops the details. The confirmation is its own native window, so
  // the pop waits until the confirmation has closed: both transitions in one frame showed a blank
  // screen.
  const confirmed = useConfirmationOutcome<TaskConfirmationRequest>(outcome);
  const closeConfirmation = confirmed.closed;
  const onClosed = useCallback(
    (requestId: number) => {
      setRequest((current) => (current?.id === requestId ? null : current));
      closeConfirmation(requestId);
    },
    [closeConfirmation],
  );

  return {
    runAction,
    openSession,
    confirm,
    confirmations: (
      <>
        <TaskConfirmations
          request={request}
          tasks={tasks}
          onClosed={onClosed}
          onStarted={confirmed.started}
          onSucceeded={confirmed.succeeded}
        />
        {resetImplementationModal ? (
          <ResetImplementationConfirmation model={resetImplementationModal} />
        ) : null}
      </>
    ),
  };
}

const NO_OUTCOME_LISTENER: ConfirmationOutcomeListener<ConfirmedTaskAction> = {};
