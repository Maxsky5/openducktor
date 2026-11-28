import type { TaskCard, WorkspaceRef } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { errorMessage } from "../../lib/errors";
import { taskStopImpactQueryKeys } from "../../queries/task-stop-impact";
import { invalidateCachedTaskDocumentQueries } from "../../queries/documents";
import {
  type AgentSessionReadPort,
  refreshAgentSessionListQuery,
} from "../../queries/agent-sessions";
import { requireActiveRepo, requireWorkspaceRef } from "./task-operations-model";
import { refreshTaskWorktreeAfterOperation } from "./task-worktree-settlement";
import type { UseTaskOperationsResult } from "./task-operations-types";
import { useClientConnection } from "../../connection/client-connection-react";

type UseTaskResetOperationsArgs = {
  activeRepoPath: string | null;
  activeWorkspaceId: string | null;
  agentSessionReadPort: AgentSessionReadPort;
  refreshTaskData: UseTaskOperationsResult["refreshTaskData"];
};

export type TaskResetOperations = {
  /** Applies an event whose `worktree.reset` effect resets the implementation. */
  resetTaskImplementation: (taskId: string, eventId: string) => Promise<TaskCard>;
  resetTask: (taskId: string) => Promise<TaskCard>;
};

export function useTaskResetOperations({
  activeRepoPath,
  activeWorkspaceId,
  agentSessionReadPort,
  refreshTaskData,
}: UseTaskResetOperationsArgs): TaskResetOperations {
  const queryClient = useQueryClient();
  const { backgroundOperations, feedback, host } = useClientConnection();
  const hostClient = host.client;

  const reset = useCallback(
    async (taskId: string, eventId?: string): Promise<TaskCard> => {
      const repoPath = requireActiveRepo(activeRepoPath);
      const scope = requireWorkspaceRef(repoPath, activeWorkspaceId);
      const action = eventId ? "Reset implementation" : "Reset task";
      const committed = await backgroundOperations.run(
        { workspace: scope, target: { kind: "task", taskId }, action },
        (tracking) =>
          eventId
            ? hostClient.taskApplyEvent(scope, taskId, eventId, tracking)
            : hostClient.taskReset(scope, taskId, tracking),
        {
          onSettled: (attempt) => {
            refreshTaskWorktreeAfterOperation(queryClient, feedback, attempt);
            void invalidateTaskStopImpact(queryClient, scope).catch((error) =>
              feedback.show("error", "Could not refresh task activity", {
                description: errorMessage(error),
              }),
            );
          },
        },
      );
      try {
        await refreshTaskAfterReset(
          queryClient,
          scope,
          taskId,
          refreshTaskData,
          agentSessionReadPort,
        );
      } catch (error) {
        feedback.show(
          "error",
          eventId
            ? "Implementation reset, but metadata refresh failed"
            : "Task reset, but metadata refresh failed",
          {
            description: `${repoPath} · ${taskId}: ${errorMessage(error)}`,
          },
        );
      }
      return committed;
    },
    [
      activeRepoPath,
      activeWorkspaceId,
      agentSessionReadPort,
      backgroundOperations,
      feedback,
      hostClient,
      queryClient,
      refreshTaskData,
    ],
  );

  return { resetTaskImplementation: reset, resetTask: reset };
}

const refreshTaskAfterReset = async (
  queryClient: QueryClient,
  scope: WorkspaceRef,
  taskId: string,
  refreshTaskData: UseTaskOperationsResult["refreshTaskData"],
  agentSessionReadPort: AgentSessionReadPort,
): Promise<void> => {
  const results = await Promise.allSettled([
    invalidateTaskWorkflowQueries(queryClient, scope, taskId, agentSessionReadPort),
    refreshTaskData(scope, taskId),
  ]);
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    const details = errors.map(errorMessage).join("; ");
    throw new AggregateError(errors, `Post-reset metadata refreshes failed: ${details}`);
  }
};

const invalidateTaskStopImpact = (queryClient: QueryClient, scope: WorkspaceRef): Promise<void> =>
  queryClient.invalidateQueries({ queryKey: taskStopImpactQueryKeys.repo(scope) });

const invalidateTaskWorkflowQueries = async (
  queryClient: QueryClient,
  scope: WorkspaceRef,
  taskId: string,
  agentSessionReadPort: AgentSessionReadPort,
): Promise<void> => {
  await Promise.all([
    invalidateCachedTaskDocumentQueries(queryClient, scope, [taskId]),
    refreshAgentSessionListQuery(queryClient, scope, taskId, agentSessionReadPort),
  ]);
};
