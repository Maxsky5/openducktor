import type { AgentSessionRecord, WorkspaceRecord } from "@openducktor/contracts";
import {
  TasksStateContext,
  useRequiredContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import {
  buildActiveTaskSessionContextByTaskId,
  buildTaskSessionsByTaskId,
} from "@openducktor/frontend-core/tasks/board/kanban-board-sessions";
import type { TaskReadState } from "@openducktor/frontend-core/tasks/details/use-task-close-impact";
import { useTaskRemoveWorktreeConfirmDialog } from "@openducktor/frontend-core/tasks/details/use-task-remove-worktree-confirm-dialog";
import type { BuiltinTaskCard as TaskCard, TaskWorkflowAction } from "@openducktor/workflows";
import { useRouter } from "expo-router";
import { type ReactElement, useCallback, useMemo } from "react";
import { TaskRemoveWorktreeConfirm } from "@/features/workflow/close/task-remove-worktree-confirm";
import { useTaskActions } from "@/features/workflow/use-task-actions";
import { TaskActionsMenu } from "./task-actions-panel";
import {
  resolveTaskDetailsActions,
  type TaskDetailsAction,
  taskDetailsMenuChoice,
  taskDetailsMenuItems,
} from "./task-details-model";

type SessionSummaries = Parameters<typeof buildTaskSessionsByTaskId>[0];

type TaskDetailsActionsView = {
  primary: TaskDetailsAction | null;
  runAction: (action: TaskWorkflowAction) => void;
  menu: ReactElement;
  /** The failed worktree read of a closed task, with its retry. */
  worktreeReadError: TaskReadState | null;
  confirmations: ReactElement;
};

/**
 * The workflow actions of task details: the prominent action, the actions menu, and their
 * confirmations. The details own the worktree removal, since only they read the worktree of a
 * closed task.
 */
export function useTaskDetailsActions({
  workspace,
  task,
  tasks,
  summaries,
  records,
  scopeReady,
  showUnlink,
  unlinking,
  embedded,
  onDeleteStarted,
  onDeleteFailed,
}: {
  workspace: WorkspaceRecord;
  task: TaskCard;
  tasks: TaskCard[];
  summaries: SessionSummaries;
  records: readonly AgentSessionRecord[];
  /** The selected workspace is the workspace of the task. */
  scopeReady: boolean;
  showUnlink: boolean;
  unlinking: boolean;
  embedded: boolean;
  onDeleteStarted: () => void;
  onDeleteFailed: () => void;
}): TaskDetailsActionsView {
  const router = useRouter();
  const { unlinkPullRequest, removeTaskWorktree } = useRequiredContext(
    TasksStateContext,
    "useTaskDetailsActions",
  );
  const { runAction, confirm, confirmations } = useTaskActions({
    workspace,
    tasks,
    outcome: {
      onStarted: (request) => {
        if (request.action === "delete") onDeleteStarted();
      },
      onSucceeded: (request) => {
        if (request.action === "delete" && !embedded) router.back();
      },
      onFailed: (request) => {
        if (request.action === "delete") onDeleteFailed();
      },
    },
  });
  const taskSessions = useMemo(
    () => buildTaskSessionsByTaskId(summaries).get(task.id) ?? [],
    [summaries, task.id],
  );
  const activeContext = useMemo(
    () => buildActiveTaskSessionContextByTaskId(summaries).get(task.id),
    [summaries, task.id],
  );
  // The worktree reads use the selected workspace, so they wait until it is this one.
  const removeWorktree = useTaskRemoveWorktreeConfirmDialog({
    task,
    enabled: scopeReady,
    run: removeTaskWorktree,
  });
  const canRemoveWorktree = removeWorktree.isAvailable;
  const actions = useMemo(
    () =>
      resolveTaskDetailsActions({
        task,
        taskSessions,
        historicalSessions: records,
        activeSessionRole: activeContext?.role,
        canRemoveWorktree,
      }),
    [activeContext?.role, canRemoveWorktree, records, task, taskSessions],
  );
  const openRemoveWorktree = removeWorktree.openDialog;
  const runDetailsAction = useCallback(
    (action: TaskWorkflowAction) => {
      if (action === "remove_worktree") openRemoveWorktree();
      else runAction(task, action, actions.sessionOptionsOf);
    },
    [actions.sessionOptionsOf, openRemoveWorktree, runAction, task],
  );
  const menuItems = useMemo(
    () => taskDetailsMenuItems({ actions, enabled: scopeReady, showUnlink, unlinking }),
    [actions, scopeReady, showUnlink, unlinking],
  );
  const selectMenu = useCallback(
    (id: string) => {
      const choice = taskDetailsMenuChoice(id, actions);
      if (!choice) return;
      switch (choice.kind) {
        case "delete":
          confirm(task, "delete");
          return;
        case "unlink_pull_request":
          void unlinkPullRequest(task.id);
          return;
        case "action":
          runDetailsAction(choice.action.action);
          return;
      }
    },
    [actions, confirm, runDetailsAction, task, unlinkPullRequest],
  );
  const menu = useMemo(
    () => <TaskActionsMenu taskTitle={task.title} items={menuItems} onSelect={selectMenu} />,
    [menuItems, selectMenu, task.title],
  );
  return {
    primary: actions.primary,
    runAction: runDetailsAction,
    menu,
    worktreeReadError: removeWorktree.sheetReadError,
    confirmations: (
      <>
        {confirmations}
        <TaskRemoveWorktreeConfirm dialog={removeWorktree.dialog} />
      </>
    ),
  };
}
