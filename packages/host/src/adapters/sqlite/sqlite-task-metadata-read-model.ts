import {
  gitTargetBranchSchema,
  pullRequestSchema,
  directMergeRecordSchema,
  type TaskMetadataArtifact,
  type TaskMetadataPayload,
  taskMetadataPayloadSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import { HostResourceError } from "../../effect/host-errors";
import { and, eq } from "drizzle-orm";
import { validateWithSchema } from "./sqlite-task-store-validation";
import { readTaskSessions } from "./sqlite-task-relations";
import {
  latestWorkflowArtifactRows,
  type WorkflowArtifactRow,
} from "./sqlite-task-workflow-artifact-queries";
import type { SqliteTaskStoreReadError } from "./sqlite-task-store-errors";
import type { TaskWorkflow } from "@openducktor/workflows";
import {
  type TaskRow,
  type HostDatabaseSession,
  taskDirectMerges,
  taskPullRequests,
  tasks,
} from "./sqlite-host-database-schema";
import { directMergeFromRow, pullRequestFromRow } from "./sqlite-task-delivery-rows";

export const taskMetadata = (
  session: HostDatabaseSession,
  row: TaskRow,
  workflow: TaskWorkflow,
): Effect.Effect<TaskMetadataPayload, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const artifacts: Record<string, TaskMetadataArtifact> = {};
    const artifactRows = yield* latestWorkflowArtifactRows(
      session,
      row.workspaceId,
      row.id,
      workflow.definition.artifacts.map(({ id }) => id),
    );
    const artifactsByCode = new Map(
      artifactRows.map((artifactRow) => [artifactRow.code, artifactRow]),
    );
    for (const { id: code } of workflow.definition.artifacts) {
      const artifactRow = artifactsByCode.get(code);
      if (artifactRow) artifacts[code] = toMetadataArtifact(artifactRow);
    }
    const agentSessions = yield* readTaskSessions(session, row.workspaceId, row.id);
    const delivery = yield* taskDelivery(session, row.workspaceId, row.id, "");
    const targetBranch =
      row.targetBranch === null
        ? undefined
        : yield* validateWithSchema(
            gitTargetBranchSchema,
            { branch: row.targetBranch, remote: row.targetRemote ?? undefined },
            "target branch",
            { workspaceId: row.workspaceId, taskId: row.id },
          );
    return yield* validateWithSchema(
      taskMetadataPayloadSchema,
      {
        agentSessions,
        artifacts,
        ...delivery,
        targetBranch,
      },
      "task metadata read model",
      { taskId: row.id },
    );
  });

export const taskDelivery = (
  session: HostDatabaseSession,
  workspaceId: string,
  taskId: string,
  repoPath: string,
) =>
  Effect.gen(function* () {
    const [row] = yield* session.execute(
      (database) =>
        database
          .select({ pullRequest: taskPullRequests, directMerge: taskDirectMerges })
          .from(tasks)
          .leftJoin(
            taskPullRequests,
            and(
              eq(taskPullRequests.workspaceId, tasks.workspaceId),
              eq(taskPullRequests.taskId, tasks.id),
            ),
          )
          .leftJoin(
            taskDirectMerges,
            and(
              eq(taskDirectMerges.workspaceId, tasks.workspaceId),
              eq(taskDirectMerges.taskId, tasks.id),
            ),
          )
          .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, taskId))),
      "sqliteTaskStore.taskMetadata.selectDelivery",
    );
    if (!row)
      return yield* new HostResourceError({
        resource: "task",
        operation: "sqliteTaskRepository.getTask",
        message: `Task not found: ${taskId}`,
        details: { repoPath, taskId },
      });
    return yield* validateWithSchema(
      z.object({
        pullRequest: pullRequestSchema.optional(),
        directMerge: directMergeRecordSchema.optional(),
      }),
      {
        pullRequest: row.pullRequest ? pullRequestFromRow(row.pullRequest) : undefined,
        directMerge: row.directMerge ? directMergeFromRow(row.directMerge) : undefined,
      },
      "task delivery",
      { taskId },
    );
  });

const toIso = (value: Date | null): string | undefined => {
  if (value === null) {
    return undefined;
  }
  return value.toISOString();
};

export const toMetadataArtifact = (row: WorkflowArtifactRow): TaskMetadataArtifact => {
  const artifact: TaskMetadataArtifact = {
    markdown: row.markdown,
    revision: row.revision,
    updatedAt: toIso(row.updatedAt),
  };
  if (row.verdict !== null) artifact.verdict = row.verdict;
  return artifact;
};
