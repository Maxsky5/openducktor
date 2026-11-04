import { useSessionStartContext } from "../../sessions/start/use-session-start-context";
import type { TaskCard, WorkflowReference, WorkspaceRef } from "@openducktor/contracts";
import { taskWorkflowInput, type ResolvedTaskCard } from "@openducktor/workflows";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useClientConnection } from "../../connection/client-connection-react";
import { resolveTaskCards } from "../../queries/workflows";

/** The original choices survive an effect even when its action is no longer available. */
export type TaskWorkflowContinuation = {
  workflow: WorkflowReference;
  launchActionIds: readonly string[];
};
/**
 * Starts the following launch of a committed effect. The effect owner passes the task card that its
 * host command returned, so no task read runs after the commit.
 */
export type ContinueTaskWorkflow = (
  committed: TaskCard,
  continuation?: TaskWorkflowContinuation,
  context?: { humanFeedback?: string },
) => Promise<void>;
/** Called with the task card that a committed host command returned. */
export type OnTaskCommitted = (committed: TaskCard) => Promise<void>;
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
    async (committed, continuation, context) => {
      if (!continuation?.launchActionIds.length) return;
      try {
        if (!scope || !onLaunch)
          throw new Error(
            "This client cannot continue the committed task action. Open its workspace and update the client.",
          );
        const [task] = await resolveTaskCards(queryClient, scope, [committed]);
        if (!task) throw new Error("The host returned no committed task. Reload the task.");
        if (!isCurrent())
          throw new Error(
            "The workspace changed. Open the task in its workspace to start its session.",
          );
        const launch = selectTaskWorkflowContinuation(task, continuation);
        if (launch) onLaunch(task.id, launch, task, context?.humanFeedback);
      } catch (cause) {
        feedback.show("error", "Task updated, but its session could not start", {
          description: `Do not repeat the task action. ${cause instanceof Error ? cause.message : String(cause)}`,
        });
      }
    },
    [scope, onLaunch, queryClient, feedback, isCurrent],
  );
}
