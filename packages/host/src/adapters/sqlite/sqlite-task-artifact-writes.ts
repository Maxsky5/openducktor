import { randomUUID } from "node:crypto";
import {
  freeArtifactCodeSchema,
  TASK_ARTIFACT_MAX_FILE_BYTES,
  type TaskArtifact,
} from "@openducktor/contracts";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { HostResourceError, HostValidationError } from "../../effect/host-errors";
import type {
  ArtifactStoreContent,
  ArtifactStoreReference,
  ArtifactStoreScope,
} from "../../ports/task-repository-ports";
import { artifactMetadataFromRow, artifactMetadataSelection } from "./sqlite-task-artifact-queries";
import { requireTaskRow } from "./sqlite-task-queries";
import type { SqliteTaskStoreWriteError } from "./sqlite-task-store-errors";
import {
  type TaskArtifactRow,
  type TaskStoreSession,
  taskArtifacts,
} from "./sqlite-task-store-schema";

export const createArtifactInDatabase = (
  session: TaskStoreSession,
  input: ArtifactStoreScope & ArtifactStoreContent & { name: string; code?: string | undefined },
  updatedAt: Date,
): Effect.Effect<TaskArtifact, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    yield* requireMutableTask(session, input);
    yield* validateContentSize(input.content);
    const code = yield* pickCode(session, input);
    const row = {
      artifactId: randomUUID(),
      taskId: input.taskId,
      classification: "free" as const,
      workflowKind: null,
      code,
      name: input.name,
      revision: 1,
      updatedAt,
      verdict: null,
      fileName: input.fileName,
      mediaType: input.mediaType,
      byteSize: input.content.byteLength,
    };
    const artifact = yield* artifactMetadataFromRow(row);
    yield* session.execute(
      (database) =>
        database.insert(taskArtifacts).values({ ...row, content: Buffer.from(input.content) }),
      "sqliteTaskRepository.createArtifact.insert",
    );
    return artifact;
  });

export const renameArtifactInDatabase = (
  session: TaskStoreSession,
  input: ArtifactStoreReference & { name: string },
  updatedAt: Date,
): Effect.Effect<TaskArtifact, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const previous = yield* requireFreeArtifact(session, input);
    const changes = { name: input.name, revision: previous.revision + 1, updatedAt };
    const artifact = yield* artifactMetadataFromRow({ ...previous, ...changes });
    yield* session.execute(
      (database) =>
        database
          .update(taskArtifacts)
          .set(changes)
          .where(
            and(
              eq(taskArtifacts.taskId, input.taskId),
              eq(taskArtifacts.artifactId, input.artifactId),
            ),
          ),
      "sqliteTaskRepository.renameArtifact.update",
    );
    return artifact;
  });

export const replaceArtifactInDatabase = (
  session: TaskStoreSession,
  input: ArtifactStoreReference & ArtifactStoreContent & { name?: string | undefined },
  updatedAt: Date,
): Effect.Effect<TaskArtifact, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const previous = yield* requireFreeArtifact(session, input);
    yield* validateContentSize(input.content);
    const changes = {
      name: input.name ?? previous.name,
      fileName: input.fileName,
      mediaType: input.mediaType,
      byteSize: input.content.byteLength,
      revision: previous.revision + 1,
      updatedAt,
    };
    const artifact = yield* artifactMetadataFromRow({ ...previous, ...changes });
    yield* session.execute(
      (database) =>
        database
          .update(taskArtifacts)
          .set({ ...changes, content: Buffer.from(input.content) })
          .where(
            and(
              eq(taskArtifacts.taskId, input.taskId),
              eq(taskArtifacts.artifactId, input.artifactId),
            ),
          ),
      "sqliteTaskRepository.replaceArtifact.update",
    );
    return artifact;
  });

export const deleteArtifactInDatabase = (
  session: TaskStoreSession,
  input: ArtifactStoreReference,
): Effect.Effect<boolean, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    yield* requireFreeArtifact(session, input);
    yield* session.execute(
      (database) =>
        database
          .delete(taskArtifacts)
          .where(
            and(
              eq(taskArtifacts.taskId, input.taskId),
              eq(taskArtifacts.artifactId, input.artifactId),
            ),
          ),
      "sqliteTaskRepository.deleteArtifact.delete",
    );
    return true;
  });

const pickCode = (
  session: TaskStoreSession,
  input: ArtifactStoreScope & { name: string; code?: string | undefined },
): Effect.Effect<string, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    if (input.code !== undefined) {
      const parsed = freeArtifactCodeSchema.safeParse(input.code);
      if (!parsed.success) {
        return yield* new HostValidationError({
          message: parsed.error.issues[0]?.message ?? "Use a valid free artifact code.",
          field: "code",
        });
      }
    }
    const rows = yield* session.execute(
      (database) =>
        database
          .select({ code: taskArtifacts.code })
          .from(taskArtifacts)
          .where(
            and(eq(taskArtifacts.taskId, input.taskId), eq(taskArtifacts.classification, "free")),
          ),
      "sqliteTaskRepository.createArtifact.selectCodes",
    );
    const usedCodes = new Set(rows.map((row) => row.code));
    if (input.code !== undefined) {
      if (usedCodes.has(input.code)) {
        return yield* new HostValidationError({
          message: `Artifact code '${input.code}' already exists in this task. Choose another code or replace that artifact.`,
          field: "code",
        });
      }
      return input.code;
    }
    const slug = input.name
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
    let base = slug || "artifact";
    if (!/^[a-z]/u.test(base) || base === "spec" || base === "plan") {
      base = `artifact-${base}`;
    }
    base = base.slice(0, 128).replace(/-+$/u, "");
    let code = base;
    for (let suffix = 2; usedCodes.has(code); suffix++) {
      const ending = `-${suffix}`;
      code = `${base.slice(0, 128 - ending.length).replace(/-+$/u, "")}${ending}`;
    }
    return code;
  });

const requireMutableTask = (
  session: TaskStoreSession,
  input: ArtifactStoreScope,
): Effect.Effect<void, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const task = yield* requireTaskRow(session, input.taskId, input.repoPath);
    if (task.status === "closed") {
      return yield* new HostValidationError({
        message: "Closed tasks are read-only. Reopen the task before changing a free artifact.",
        field: "taskId",
      });
    }
  });

const validateContentSize = (content: Uint8Array): Effect.Effect<void, HostValidationError> =>
  content.byteLength > TASK_ARTIFACT_MAX_FILE_BYTES
    ? Effect.fail(
        new HostValidationError({
          message: "An artifact can contain at most 10 MiB. Choose a smaller file.",
          field: "content",
        }),
      )
    : Effect.void;

const requireFreeArtifact = (
  session: TaskStoreSession,
  input: ArtifactStoreReference,
): Effect.Effect<
  Pick<TaskArtifactRow, keyof typeof artifactMetadataSelection>,
  SqliteTaskStoreWriteError
> =>
  Effect.gen(function* () {
    yield* requireMutableTask(session, input);
    if (input.artifactId.startsWith(`workflow:${input.taskId}:`)) {
      return yield* new HostValidationError({
        message:
          "Use the Specification, Implementation Plan, or QA workflow control to change a workflow artifact.",
        field: "artifactId",
      });
    }
    const rows = yield* session.execute(
      (database) =>
        database
          .select(artifactMetadataSelection)
          .from(taskArtifacts)
          .where(
            and(
              eq(taskArtifacts.taskId, input.taskId),
              eq(taskArtifacts.artifactId, input.artifactId),
              eq(taskArtifacts.classification, "free"),
            ),
          )
          .limit(1),
      "sqliteTaskRepository.requireFreeArtifact",
    );
    const artifact = rows[0];
    if (!artifact) {
      return yield* new HostResourceError({
        message: "Artifact not found in this task. Refresh the artifact collection.",
        resource: input.artifactId,
        operation: "taskArtifact.mutate",
      });
    }
    return artifact;
  });
