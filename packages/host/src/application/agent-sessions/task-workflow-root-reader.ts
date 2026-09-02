import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { Effect } from "effect";
import { type HostError, toHostOperationError } from "../../effect/host-errors";
import type { TaskStorePort } from "../../ports/task-repository-ports";

export type TaskWorkflowRootReader = (
  repoPath: string,
) => Effect.Effect<ReadonlyArray<AgentSessionLiveRef>, HostError>;

export const createTaskWorkflowRootReader = (
  store: Pick<TaskStorePort, "listTasks" | "listAgentSessionsForTasks">,
): TaskWorkflowRootReader => {
  const read = Effect.fn("TaskWorkflowRootReader.read")(function* (repoPath) {
    const tasks = yield* store.listTasks({ repoPath });
    if (tasks.length === 0) {
      return [];
    }
    const records = yield* store.listAgentSessionsForTasks({
      repoPath,
      taskIds: tasks.map(({ id }) => id),
    });
    const roots = new Map<string, AgentSessionLiveRef>();
    for (const { agentSessions } of records) {
      for (const session of agentSessions) {
        const root = {
          repoPath,
          externalSessionId: session.externalSessionId,
          runtimeKind: session.runtimeKind,
          workingDirectory: session.workingDirectory,
        };
        roots.set(agentSessionRefKey(root), root);
      }
    }
    return [...roots.values()];
  });
  return (repoPath) =>
    read(repoPath).pipe(
      Effect.mapError((cause) =>
        toHostOperationError(cause, "task-workflow-root-reader.read", { repoPath }),
      ),
    );
};
