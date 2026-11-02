import type { TaskArtifactChange } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  recordCommittedTaskMutation,
  recordCommittedTaskStatusChange,
} from "../../ports/task-status-changes";
import type { SqliteTaskRepositoryContext } from "./sqlite-task-repository-context";
import type { HostDatabaseSession } from "./sqlite-host-database-schema";

export type TaskMutationResult<A> = {
  value: A;
  taskId?: string;
  removed?: boolean;
  artifactChanges?: TaskArtifactChange[];
  transition?: Parameters<typeof recordCommittedTaskStatusChange>[0];
};

export const commitTaskMutation = <A, E>(
  context: SqliteTaskRepositoryContext,
  operation: string,
  use: (session: HostDatabaseSession) => Effect.Effect<TaskMutationResult<A>, E>,
) =>
  context.session.transaction(operation, (session) =>
    Effect.gen(function* () {
      const result = yield* use(session);
      const taskId = result.taskId;
      if (taskId !== undefined)
        yield* session.afterCommit(
          Effect.gen(function* () {
            yield* recordCommittedTaskMutation({
              taskIds: result.removed ? [] : [taskId],
              removedTaskIds: result.removed ? [taskId] : [],
              artifactChanges: result.artifactChanges ?? [],
            });
            if (result.transition) yield* recordCommittedTaskStatusChange(result.transition);
          }),
        );
      return result.value;
    }),
  );
