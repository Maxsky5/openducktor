import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import {
  type TaskWorkflowActions,
  useRequiredTaskWorkflowActions,
} from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import { useTasksState, useWorkspaceState } from "@/state/app-state-provider";

/** The latest active-workspace values when an intent runs. */
export type WorkspaceIntentContext = {
  workflow: TaskWorkflowActions;
  refreshTasks: () => Promise<void>;
  /** Opens a page. It asks the transition guard, unless the workspace switch already did. */
  navigate: (href: string) => void;
};

/** An action that must run with its workspace active. */
export type WorkspaceIntent = {
  workspaceId: string;
  /** The intent runs only when the workspace tasks contain this task. */
  taskId?: string;
  run: (context: WorkspaceIntentContext) => void;
};

/**
 * `active`: the workspace was active when the intent started.
 * `guard`: the transition guard or the workspace switch has not finished.
 * `switched`: the switch finished. The workspace state can still be in a later render.
 */
type PendingIntent = {
  id: number;
  intent: WorkspaceIntent;
  phase: "active" | "guard" | "switched";
};

export type WorkspaceIntentRunner = {
  runIntent: (intent: WorkspaceIntent) => void;
  /** Drop the intent that waits, so it cannot run after the user moved on. */
  cancelIntent: () => void;
};

/**
 * Run palette intents in their workspace. A target that is not active becomes active first,
 * through the transition guard. Only the newest intent waits. A cancelled, failed, or replaced
 * switch drops it.
 */
export function useWorkspaceIntentRunner(): WorkspaceIntentRunner {
  const navigate = useNavigate();
  const { run: guardTransition } = useWorkspacePreviewTransitionGuard();
  const { activeWorkspace, isSwitchingWorkspace, selectWorkspace } = useWorkspaceState();
  const {
    tasks,
    tasksAreCurrent,
    isForegroundLoadingTasks,
    isRefreshingTasksInBackground,
    refreshTasks,
  } = useTasksState();
  const workflow = useRequiredTaskWorkflowActions();
  const [pending, setPending] = useState<PendingIntent | null>(null);
  const nextIdRef = useRef(0);
  // The async guard callback and `runIntent` read these refs, so both see the latest values.
  const pendingIdRef = useRef<number | null>(null);
  const workspaceRef = useRef({
    activeWorkspaceId: activeWorkspace?.workspaceId ?? null,
    isSwitchingWorkspace,
  });
  useLayoutEffect(() => {
    workspaceRef.current = {
      activeWorkspaceId: activeWorkspace?.workspaceId ?? null,
      isSwitchingWorkspace,
    };
  }, [activeWorkspace?.workspaceId, isSwitchingWorkspace]);

  const startPending = useCallback((next: PendingIntent): void => {
    pendingIdRef.current = next.id;
    setPending(next);
  }, []);
  const dropPending = useCallback((id: number): void => {
    if (pendingIdRef.current !== id) return;
    pendingIdRef.current = null;
    setPending(null);
  }, []);
  const cancelIntent = useCallback((): void => {
    pendingIdRef.current = null;
    setPending(null);
  }, []);

  const runIntent = useCallback(
    (intent: WorkspaceIntent): void => {
      nextIdRef.current += 1;
      const id = nextIdRef.current;
      const { activeWorkspaceId, isSwitchingWorkspace: switching } = workspaceRef.current;
      if (activeWorkspaceId === intent.workspaceId && !switching) {
        startPending({ id, intent, phase: "active" });
        return;
      }
      startPending({ id, intent, phase: "guard" });
      guardTransition(
        async () => {
          if (pendingIdRef.current !== id) return false;
          try {
            // Selection shows its own error toast.
            await selectWorkspace(intent.workspaceId);
          } catch {
            dropPending(id);
            return false;
          }
          if (pendingIdRef.current !== id) return true;
          setPending({ id, intent, phase: "switched" });
          return true;
        },
        () => dropPending(id),
        { waitForSuccess: true },
      );
    },
    [dropPending, guardTransition, selectWorkspace, startPending],
  );

  useEffect(() => {
    if (!pending || pending.phase === "guard" || isSwitchingWorkspace) return;
    if (!activeWorkspace || activeWorkspace.workspaceId !== pending.intent.workspaceId) {
      // A newer switch or a workspace change replaced the target.
      dropPending(pending.id);
      return;
    }
    const { taskId } = pending.intent;
    if (taskId !== undefined) {
      // A task action needs a completed task read, also when an older list still has the task.
      if (!tasksAreCurrent) {
        if (isForegroundLoadingTasks || isRefreshingTasksInBackground) return;
        // A failed read drops the intent, so it never runs late with old task state.
        dropPending(pending.id);
        toast.error(`Tasks of ${activeWorkspace.workspaceName} did not load.`, {
          description: `Refresh the tasks, then run the action on ${taskId} again.`,
        });
        return;
      }
      if (!tasks.some((task) => task.id === taskId)) {
        dropPending(pending.id);
        toast.error(`Task ${taskId} is not in ${activeWorkspace.workspaceName}.`, {
          description: "It was deleted or is no longer on the Kanban board.",
        });
        return;
      }
    }
    dropPending(pending.id);
    pending.intent.run({
      workflow,
      refreshTasks,
      navigate:
        pending.phase === "switched"
          ? (href) => void navigate(href)
          : (href) => guardTransition(() => void navigate(href)),
    });
  }, [
    activeWorkspace,
    dropPending,
    guardTransition,
    isForegroundLoadingTasks,
    isRefreshingTasksInBackground,
    isSwitchingWorkspace,
    navigate,
    pending,
    refreshTasks,
    tasks,
    tasksAreCurrent,
    workflow,
  ]);

  return { runIntent, cancelIntent };
}
