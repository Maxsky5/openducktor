import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { type TaskArtifact, taskArtifactSchema } from "@openducktor/contracts";
import { and, asc, desc, eq, gt, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";
import type {
  ArtifactStoreReference,
  StoredArtifactContent,
} from "../../ports/task-repository-ports";
import { validateWithSchema } from "./sqlite-json-codecs";
import {
  SqliteTaskStoreDataError,
  type SqliteTaskStoreReadError,
} from "./sqlite-task-store-errors";
import {
  type TaskArtifactRow,
  type TaskStoreSession,
  taskArtifacts,
} from "./sqlite-task-store-schema";

export const artifactMetadataSelection = {
  artifactId: taskArtifacts.artifactId,
  taskId: taskArtifacts.taskId,
  classification: taskArtifacts.classification,
  workflowKind: taskArtifacts.workflowKind,
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
  session: TaskStoreSession,
  taskId: string,
): Effect.Effect<TaskArtifact[], SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const rows = yield* session.execute((database) => {
      const newer = alias(taskArtifacts, "newer_artifact");
      return database
        .select(artifactMetadataSelection)
        .from(taskArtifacts)
        .where(
          and(
            eq(taskArtifacts.taskId, taskId),
            notExists(
              database
                .select({ value: sql<number>`1` })
                .from(newer)
                .where(
                  and(
                    eq(newer.artifactId, taskArtifacts.artifactId),
                    gt(newer.revision, taskArtifacts.revision),
                  ),
                ),
            ),
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
  session: TaskStoreSession,
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
    const version = createHash("sha256")
      .update(JSON.stringify([input.repoPath, artifact]))
      .update(content)
      .digest("hex");
    return { artifact, content, version, isUtf8: isUtf8(content) };
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
  let workflowKind: string | null = row.workflowKind;
  if (workflowKind === "implementation_plan") {
    workflowKind = "plan";
  } else if (workflowKind === "qa_report") {
    workflowKind = "qaReport";
  }
  const workflow = {
    ...base,
    workflowKind,
    mediaType: "text/markdown",
  };
  const metadata =
    row.workflowKind === "qa_report"
      ? { ...workflow, verdict: row.verdict ?? "not_reviewed" }
      : workflow;
  return validateWithSchema(taskArtifactSchema, metadata, "task artifact metadata", {
    taskId: row.taskId,
  });
};
