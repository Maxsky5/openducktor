import { sqliteValues } from "./sqlite-parameters";
import { type TaskMetadataArtifact, workflowArtifactId } from "@openducktor/contracts";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { requireTaskRow } from "./sqlite-task-queries";
import {
  SqliteTaskStoreDataError,
  type SqliteTaskStoreWriteError,
} from "./sqlite-task-store-errors";
import {
  TASK_WORKFLOW_ARTIFACT_FORMAT_PLAIN_TEXT,
  type TaskArtifactInsert,
  type HostDatabaseSession,
  taskArtifacts,
} from "./sqlite-host-database-schema";

/** A new revision of a workflow artifact. The caller names its command and acting role. */
export const insertWorkflowArtifact = (
  session: HostDatabaseSession,
  workspaceId: string,
  input: {
    code: string;
    name: string;
    markdown: string;
    taskId: string;
    updatedAt: Date;
    verdict?: string | undefined;
    sourceTool: string;
    updatedBy: string;
  },
): Effect.Effect<TaskMetadataArtifact, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const { code, verdict } = input;
    const revision = yield* nextWorkflowArtifactRevision(session, workspaceId, input.taskId, code);
    const markdown = input.markdown.trim();
    const artifact: TaskArtifactInsert = {
      workspaceId,
      artifactId: workflowArtifactId(input.taskId, code),
      classification: "workflow",
      code,
      name: input.name,
      format: TASK_WORKFLOW_ARTIFACT_FORMAT_PLAIN_TEXT,
      markdown,
      revision,
      sourceTool: input.sourceTool,
      taskId: input.taskId,
      updatedAt: input.updatedAt,
      updatedBy: input.updatedBy,
      verdict: verdict ?? null,
    };
    yield* session.execute(
      (database) => database.insert(taskArtifacts).values(artifact),
      "sqliteTaskStore.insertWorkflowArtifact.insertWorkflowArtifact",
      { code, taskId: input.taskId },
    );
    return {
      markdown,
      revision,
      updatedAt: input.updatedAt.toISOString(),
    };
  });

/** Deletes every revision of the workflow artifacts with these codes. */
export const clearWorkflowArtifacts = (
  session: HostDatabaseSession,
  workspaceId: string,
  taskId: string,
  repoPath: string,
  codes: readonly string[],
): Effect.Effect<string[], SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    yield* requireTaskRow(session, workspaceId, taskId, repoPath);
    if (codes.length === 0) return [];
    const deleted = yield* session.execute(
      (database) =>
        database
          .delete(taskArtifacts)
          .where(
            and(
              eq(taskArtifacts.workspaceId, workspaceId),
              eq(taskArtifacts.taskId, taskId),
              eq(taskArtifacts.classification, "workflow"),
              inArray(taskArtifacts.code, sqliteValues([...codes])),
            ),
          )
          .returning({ artifactId: taskArtifacts.artifactId }),
      "sqliteTaskRepository.clearWorkflowArtifacts.deleteArtifacts",
    );
    return [...new Set(deleted.map(({ artifactId }) => artifactId))];
  });

export const clearTaskArtifacts = (
  session: HostDatabaseSession,
  workspaceId: string,
  taskId: string,
  repoPath: string,
): Effect.Effect<string[], SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    yield* requireTaskRow(session, workspaceId, taskId, repoPath);
    const deleted = yield* session.execute(
      (database) =>
        database
          .delete(taskArtifacts)
          .where(and(eq(taskArtifacts.workspaceId, workspaceId), eq(taskArtifacts.taskId, taskId)))
          .returning({ artifactId: taskArtifacts.artifactId }),
      "sqliteTaskRepository.clearTaskArtifacts.deleteArtifacts",
    );
    return [...new Set(deleted.map(({ artifactId }) => artifactId))];
  });

const nextWorkflowArtifactRevision = (
  session: HostDatabaseSession,
  workspaceId: string,
  taskId: string,
  code: string,
): Effect.Effect<number, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (database) =>
        database
          .select({ revision: sql<number | null>`max(${taskArtifacts.revision})` })
          .from(taskArtifacts)
          .where(
            and(
              eq(taskArtifacts.workspaceId, workspaceId),
              eq(taskArtifacts.taskId, taskId),
              eq(taskArtifacts.classification, "workflow"),
              eq(taskArtifacts.code, code),
            ),
          )
          .limit(1),
      "sqliteTaskStore.nextWorkflowArtifactRevision.selectRevision",
      { code, taskId },
    );
    const revision = rows[0]?.revision ?? null;
    if (revision === null) {
      return 1;
    }
    const parsedRevision = z.number().safeParse(revision);
    if (!parsedRevision.success) {
      return yield* new SqliteTaskStoreDataError({
        message: "SQLite workflow artifact revision must be a number.",
        field: "revision",
        details: { code, taskId, value: revision },
      });
    }
    return parsedRevision.data + 1;
  });
