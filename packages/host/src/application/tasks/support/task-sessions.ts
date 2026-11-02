import { Effect } from "effect";
import { HostInvariantError } from "../../../effect/host-errors";
import type { TaskStorePort } from "../../../ports/task-repository-ports";

export const loadTaskSessions = (
  store: Pick<TaskStorePort, "listAgentSessionsForTasks">,
  scope: { workspaceId: string; repoPath: string; taskId: string },
) =>
  Effect.gen(function* () {
    const [record] = yield* store.listAgentSessionsForTasks({
      workspaceId: scope.workspaceId,
      repoPath: scope.repoPath,
      taskIds: [scope.taskId],
    });
    if (!record)
      return yield* new HostInvariantError({
        invariant: "task-agent-sessions-result",
        message: `Task store returned no session result for task: ${scope.taskId}`,
        details: scope,
      });
    return record.agentSessions;
  });
