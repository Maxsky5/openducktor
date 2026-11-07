import { pullRequestSchema, TASK_CLOSED_STATE } from "@openducktor/contracts";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { Effect } from "effect";
import { pullRequestFromRow } from "./sqlite-task-delivery-rows";
import { validateWithSchema } from "./sqlite-task-store-validation";
import { taskPullRequests, tasks, type HostDatabaseSession } from "./sqlite-host-database-schema";

export const listPullRequestSyncCandidatesInDatabase = (
  session: HostDatabaseSession,
  workspaceId: string,
) =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (db) =>
        db
          .select({ task: { id: tasks.id, status: tasks.status }, pullRequest: taskPullRequests })
          .from(tasks)
          .innerJoin(
            taskPullRequests,
            and(
              eq(taskPullRequests.workspaceId, tasks.workspaceId),
              eq(taskPullRequests.taskId, tasks.id),
            ),
          )
          .where(
            and(
              eq(tasks.workspaceId, workspaceId),
              ne(tasks.status, TASK_CLOSED_STATE),
              inArray(taskPullRequests.state, ["open", "draft"]),
            ),
          )
          .orderBy(desc(tasks.updatedAt), asc(tasks.id)),
      "sqliteTaskStore.listPullRequestSyncCandidates.selectTasks",
    );
    return yield* Effect.forEach(rows, ({ task, pullRequest }) =>
      validateWithSchema(pullRequestSchema, pullRequestFromRow(pullRequest), "pull request", {
        workspaceId,
        taskId: task.id,
      }).pipe(Effect.map((record) => ({ id: task.id, status: task.status, pullRequest: record }))),
    );
  });
