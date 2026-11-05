import {
  useTaskWorkflowContinuation,
  type OnTaskCommitted,
} from "@openducktor/frontend-core/tasks/workflow/task-workflow-continuation";
import { createTaskActionRunner } from "@openducktor/frontend-core/tasks/workflow/task-action-runner";
import { useTaskActionTasks } from "@openducktor/frontend-core/queries/use-task-action-tasks";
import { useWorkflowEventActions } from "@openducktor/frontend-core/tasks/workflow/use-workflow-event-actions";
import type { WorkspaceRecord } from "@openducktor/contracts";
import {
  TasksStateContext,
  useRequiredContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  type TaskWorkflowAction,
  type ResolvedTaskCard as TaskCard,
  type WorkflowRoleId as AgentRole,
} from "@openducktor/workflows";
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
import { showNoSession, type TaskConfirmationAction } from "./task-action-routing";

export type TaskActions = {
  /** Runs a workflow action of a task. `sessionOptionsOf` names the session of each role. */
  runAction: (
    task: TaskCard,
    action: TaskWorkflowAction,
    sessionOptionsOf: (role: AgentRole) => SessionTargetOptions | undefined,
  ) => void;
  openSession: (task: TaskCard, role: AgentRole, options: SessionTargetOptions) => void;
  /** Asks for the confirmation of an action that has no workflow action ID, such as Delete. */
  confirm: (
    task: TaskCard,
    action: Exclude<TaskConfirmationAction, "reset_implementation">,
  ) => void;
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
  tasks: visibleTasks,
  outcome = NO_OUTCOME_LISTENER,
  onRemoveWorktree,
}: {
  workspace: WorkspaceRecord;
  tasks: TaskCard[];
  outcome?: ConfirmationOutcomeListener<ConfirmedTaskAction> | undefined;
  onRemoveWorktree?: (() => void) | undefined;
}): TaskActions {
  const router = useRouter();
  const { feedback } = useClientConnection();
  const { resetTaskImplementation } = useRequiredContext(TasksStateContext, "useTaskActions");
  const { workspaceId, repoPath } = workspace;
  const tasks = useTaskActionTasks(workspace, visibleTasks);
  const [request, setRequest] = useState<TaskConfirmationRequest | null>(null);
  const nextRequestId = useRef(0);
  const workspaceIdentity = useMemo(() => ({ workspaceId, repoPath }), [repoPath, workspaceId]);
  const openSession = useCallback(
    (_task: TaskCard, _role: AgentRole, options: SessionTargetOptions) => {
      router.push(routes.session(sessionParams(workspaceId, options.session)));
    },
    [router, workspaceId],
  );

  const launch = useCallback(
    (taskId: string, launchActionId: string, committedTask?: TaskCard) => {
      const task = committedTask ?? tasks.find(({ id }) => id === taskId);
      if (!task) throw new Error("Task workflow is unavailable. Reload the task.");
      const choice = task.taskWorkflow.launchAction(launchActionId);
      router.push(
        choice.context === "human_feedback"
          ? routes.requestChanges(workspaceId, taskId, {
              kind: "launch",
              launchActionId: choice.id,
            })
          : routes.quickAction(workspaceId, taskId, choice.id),
        SINGLE_SHEET,
      );
    },
    [router, workspaceId, tasks],
  );
  const continueTaskWorkflow = useTaskWorkflowContinuation(workspaceIdentity, launch);
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

  const confirm = useCallback(
    (
      task: TaskCard,
      action: Exclude<TaskConfirmationAction, "reset_implementation">,
      onCommitted?: OnTaskCommitted,
    ) => {
      nextRequestId.current += 1;
      setRequest({ id: nextRequestId.current, taskId: task.id, action, onCommitted });
    },
    [],
  );

  const events = useWorkflowEventActions(repoPath, tasks, launch, workspaceId);
  const runAction = useCallback<TaskActions["runAction"]>(
    (task, action, sessionOptionsOf) =>
      createTaskActionRunner({
        onLaunch: launch,
        onApplyEvent: events.onApplyEvent,
        onOpenTaskDetails: (taskId) => router.push(routes.task(workspaceId, taskId)),
        onOpenSession: (_taskId, role, options) =>
          options ? openSession(task, role, options) : showNoSession(feedback, task, role),
        onHumanApprove: (taskId) =>
          router.push(routes.approveTask(workspaceId, taskId), SINGLE_SHEET),
        onHumanFeedback: (taskId, eventId, continuation) =>
          router.push(
            routes.requestChanges(workspaceId, taskId, { kind: "event", eventId, continuation }),
            SINGLE_SHEET,
          ),
        // The only workflow confirmation is the worktree reset of an event.
        onConfirm: (taskId, _confirmation, eventId, onCommitted) =>
          openReset.current(taskId, eventId, { closeDetailsAfterReset: true, onCommitted }),
        continueTaskWorkflow,
        showError: (title, description) => feedback.show("error", title, { description }),
      })(task, action, { sessionOptionsOf, onRemoveWorktree }),
    [
      launch,
      events,
      router,
      workspaceId,
      openSession,
      feedback,
      continueTaskWorkflow,
      onRemoveWorktree,
    ],
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
