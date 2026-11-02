import { type TaskArtifact, taskArtifactSchema } from "@openducktor/contracts";
import { and, asc, desc, eq, max } from "drizzle-orm";
import { Effect } from "effect";
import type {
  ArtifactStoreReference,
  StoredArtifactContent,
} from "../../ports/task-repository-ports";
import { validateWithSchema } from "./sqlite-task-store-validation";
import {
  SqliteTaskStoreDataError,
  type SqliteTaskStoreReadError,
} from "./sqlite-task-store-errors";
import {
  type TaskArtifactRow,
  type HostDatabaseSession,
  taskArtifacts,
} from "./sqlite-host-database-schema";

export const artifactMetadataSelection = {
  artifactId: taskArtifacts.artifactId,
  taskId: taskArtifacts.taskId,
  classification: taskArtifacts.classification,
  code: taskArtifacts.code,
  revision: taskArtifacts.revision,
  name: taskArtifacts.name,
  updatedAt: taskArtifacts.updatedAt,
  verdict: taskArtifacts.verdict,
  fileName: taskArtifacts.fileName,
  mediaType: taskArtifacts.mediaType,
  byteSize: taskArtifacts.byteSize,
};

type ArtifactMetadataRow = Pick<TaskArtifactRow, keyof typeof artifactMetadataSelection>;

export const listArtifactsInDatabase = (
  session: HostDatabaseSession,
  workspaceId: string,
  taskId: string,
): Effect.Effect<TaskArtifact[], SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const rows = yield* session.execute((database) => {
      const latest = database
        .select({
          artifactId: taskArtifacts.artifactId,
          revision: max(taskArtifacts.revision).as("latest_revision"),
        })
        .from(taskArtifacts)
        .where(and(eq(taskArtifacts.workspaceId, workspaceId), eq(taskArtifacts.taskId, taskId)))
        .groupBy(taskArtifacts.artifactId)
        .as("latest");
      return database
        .select(artifactMetadataSelection)
        .from(taskArtifacts)
        .innerJoin(
          latest,
          and(
            eq(taskArtifacts.workspaceId, workspaceId),
            eq(taskArtifacts.artifactId, latest.artifactId),
            eq(taskArtifacts.revision, latest.revision),
          ),
        )
        .orderBy(
          asc(taskArtifacts.classification),
          asc(taskArtifacts.name),
          asc(taskArtifacts.artifactId),
        );
    }, "sqliteTaskRepository.listArtifacts.selectMetadata");
    return yield* Effect.forEach(rows, artifactMetadataFromRow);
  });

export const readArtifactInDatabase = (
  session: HostDatabaseSession,
  workspaceId: string,
  input: ArtifactStoreReference,
): Effect.Effect<StoredArtifactContent | null, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (database) =>
        database
          .select({
            ...artifactMetadataSelection,
            markdown: taskArtifacts.markdown,
            content: taskArtifacts.content,
          })
          .from(taskArtifacts)
          .where(
            and(
              eq(taskArtifacts.workspaceId, workspaceId),
              eq(taskArtifacts.taskId, input.taskId),
              eq(taskArtifacts.artifactId, input.artifactId),
            ),
          )
          .orderBy(desc(taskArtifacts.revision))
          .limit(1),
      "sqliteTaskRepository.readArtifact.selectContent",
    );
    const row = rows[0];
    if (!row) return null;
    const artifact = yield* artifactMetadataFromRow(row);
    let content = row.content;
    if (row.classification === "workflow") {
      content = row.markdown === null ? null : Buffer.from(row.markdown, "utf8");
    }
    if (content === null) {
      return yield* new SqliteTaskStoreDataError({
        message:
          "The stored artifact content is missing. Restore the task store from a valid backup.",
        field: "content",
        details: { taskId: input.taskId },
      });
    }
    return { artifact, content };
  });

export const artifactMetadataFromRow = (
  row: ArtifactMetadataRow,
): Effect.Effect<TaskArtifact, SqliteTaskStoreReadError> => {
  const base = {
    artifactId: row.artifactId,
    taskId: row.taskId,
    classification: row.classification,
    revision: row.revision,
    name: row.name,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
  if (row.classification === "free") {
    return validateWithSchema(
      taskArtifactSchema,
      {
        ...base,
        code: row.code,
        fileName: row.fileName,
        mediaType: row.mediaType,
        byteSize: row.byteSize,
      },
      "task artifact metadata",
      { taskId: row.taskId },
    );
  }
  const workflow = {
    ...base,
    artifactId: row.artifactId,
    code: row.code,
    mediaType: "text/markdown",
  };
  const metadata = row.verdict === null ? workflow : { ...workflow, verdict: row.verdict };
  return validateWithSchema(taskArtifactSchema, metadata, "task artifact metadata", {
    taskId: row.taskId,
  });
};
