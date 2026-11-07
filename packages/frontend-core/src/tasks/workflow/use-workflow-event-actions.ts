import { TASK_CLOSED_STATE } from "@openducktor/contracts";
import { useTaskWorkflowContinuation } from "./task-workflow-continuation";
import { useCallback, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { type ResolvedTaskCard } from "@openducktor/workflows";
import { useClientConnection } from "../../connection/client-connection-react";
import {
  createProductionTaskChatDraftCleanup,
  runTaskStateMutation,
} from "../operations/task-chat-draft-cleanup";
import { taskStopImpactQueryKeys } from "../../queries/task-stop-impact";

/**
 * Plain events use the event command. Host effects keep their existing operation owners. The task
 * stream applies the committed change to every task view.
 */
export function useWorkflowEventActions(
  repoPath: string | null,
  tasks: readonly ResolvedTaskCard[],
  onLaunch: (taskId: string, launchActionId: string, committedTask?: ResolvedTaskCard) => void,
  workspaceId: string | null,
) {
  const scope = useMemo(
    () => (workspaceId && repoPath ? { workspaceId, repoPath } : null),
    [workspaceId, repoPath],
  );
  const continueTaskWorkflow = useTaskWorkflowContinuation(scope, onLaunch);
  const queryClient = useQueryClient();
  const { host, feedback } = useClientConnection();
  const inFlight = useRef(new Set<string>());
  const run = useCallback(
    (taskId: string, operation: () => Promise<void>) => {
      const id = `workflow-action:${JSON.stringify([repoPath, taskId])}`;
      if (inFlight.current.has(id)) return;
      inFlight.current.add(id);
      feedback.show("info", "Updating task", { id, duration: Infinity });
      void operation()
        .catch((cause) =>
          feedback.show("error", "Workflow action failed", {
            description: cause instanceof Error ? cause.message : String(cause),
          }),
        )
        .finally(() => {
          inFlight.current.delete(id);
          feedback.dismiss(id);
        });
    },
    [feedback, repoPath],
  );
  const onApplyEvent = useCallback(
    (taskId: string, eventId: string, launchActionIds: readonly string[]) =>
      run(taskId, async () => {
        if (!scope) throw new Error("Select the task workspace before running its action.");
        const previous = tasks.find(({ id }) => id === taskId);
        if (!previous) throw new Error(`Task "${taskId}" is unavailable. Reload its workspace.`);
        const event = previous.taskWorkflow.definition.events.find(({ id }) => id === eventId);
        if (!event) throw new Error(`Task workflow has no event "${eventId}". Reload the task.`);
        const finishes = event.outcomes.some(({ to }) => to === TASK_CLOSED_STATE);
        const mutation = runTaskStateMutation({
          canFinish: finishes,
          cleanup: createProductionTaskChatDraftCleanup(host.client, feedback),
          invalidateStopImpact: () =>
            queryClient.invalidateQueries({ queryKey: taskStopImpactQueryKeys.repo(scope) }),
          queryClient,
          repoPath: scope.repoPath,
          workspaceId: scope.workspaceId,
          taskIds: [taskId],
          mutation: () => host.client.taskApplyEvent(scope, taskId, eventId),
          shouldCleanup: (task) => task.status === TASK_CLOSED_STATE,
        });
        const committed = await mutation;
        await continueTaskWorkflow(committed, { workflow: previous.workflow, launchActionIds });
      }),
    [run, tasks, host, feedback, queryClient, continueTaskWorkflow, scope],
  );
  return { onApplyEvent };
}
