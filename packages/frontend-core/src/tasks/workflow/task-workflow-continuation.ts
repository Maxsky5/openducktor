import { useSessionStartContext } from "../../sessions/start/use-session-start-context";
import type { WorkflowReference, WorkspaceRef } from "@openducktor/contracts";
import { taskWorkflowInput, type ResolvedTaskCard } from "@openducktor/workflows";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useClientConnection } from "../../connection/client-connection-react";
import { unfilteredRepoTaskDataQueryOptions } from "../../queries/tasks";

/** The original choices survive an effect even when its action is no longer available. */
export type TaskWorkflowContinuation = {
  workflow: WorkflowReference;
  launchActionIds: readonly string[];
};
export type ContinueTaskWorkflow = (
  taskId: string,
  continuation?: TaskWorkflowContinuation,
  context?: { humanFeedback?: string; committedTask?: ResolvedTaskCard },
) => Promise<void>;
export type LaunchTaskWorkflow = (
  taskId: string,
  launchActionId: string,
  committedTask?: ResolvedTaskCard,
  humanFeedback?: string,
) => void;

export const selectTaskWorkflowContinuation = (
  task: ResolvedTaskCard,
  continuation: TaskWorkflowContinuation,
): string | null => {
  if (
    task.workflow.id !== continuation.workflow.id ||
    task.workflow.revision !== continuation.workflow.revision
  )
    throw new Error(
      "The committed task workflow changed. Reload the task before starting a session.",
    );
  return task.taskWorkflow.evaluator.selectLaunchAction(
    taskWorkflowInput(task),
    continuation.launchActionIds,
  );
};

/** Called only after a successful command. A later launch failure never repeats that command. */
export function useTaskWorkflowContinuation(
  scope: WorkspaceRef | null,
  onLaunch: LaunchTaskWorkflow | undefined,
): ContinueTaskWorkflow {
  const isCurrent = useSessionStartContext(scope ? JSON.stringify(scope) : null);
  const queryClient = useQueryClient();
  const { feedback } = useClientConnection();
  return useCallback(
    async (taskId, continuation, context) => {
      if (!continuation?.launchActionIds.length) return;
      try {
        if (!scope || !onLaunch)
          throw new Error(
            "This client cannot continue the committed task action. Open its workspace and update the client.",
          );
        // Commands without a task result need one explicit post-commit read.
        let committed = context?.committedTask;
        if (!committed) {
          const data = await queryClient.fetchQuery({
            ...unfilteredRepoTaskDataQueryOptions(scope),
            staleTime: 0,
          });
          committed = data.tasks.find(({ id }) => id === taskId);
        }
        if (!committed)
          throw new Error(
            `Task "${taskId}" is unavailable after its action. Reload its workspace.`,
          );
        if (committed.id !== taskId)
          throw new Error("The committed task does not match this continuation. Reload the task.");
        if (!isCurrent())
          throw new Error(
            "The workspace changed. Open the task in its workspace to start its session.",
          );
        const launch = selectTaskWorkflowContinuation(committed, continuation);
        if (launch) onLaunch(taskId, launch, committed, context?.humanFeedback);
      } catch (cause) {
        feedback.show("error", "Task updated, but its session could not start", {
          description: `Do not repeat the task action. ${cause instanceof Error ? cause.message : String(cause)}`,
        });
      }
    },
    [scope, onLaunch, queryClient, feedback, isCurrent],
  );
}
