import { agentSessionRecordSchema, type AgentSessionRecord } from "@openducktor/contracts";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";
import { sqliteBatches, sqliteValues } from "./sqlite-parameters";
import { normalizeLabels } from "../../domain/task/task-labels";
import { parseAgentSessionStartedAt } from "../../domain/agent-session-records";
import { validateWithSchema } from "./sqlite-task-store-validation";
import { SqliteTaskStoreDataError } from "./sqlite-task-store-errors";
import {
  taskLabels,
  taskSessions,
  type TaskSessionRow,
  type HostDatabaseSession,
} from "./sqlite-host-database-schema";

export const taskRelationScope = (
  table: { workspaceId: AnySQLiteColumn; taskId: AnySQLiteColumn },
  workspaceId: string,
  taskId: string,
) => and(eq(table.workspaceId, workspaceId), eq(table.taskId, taskId));

export const selectedModelColumns = (model: AgentSessionRecord["selectedModel"]) => ({
  modelRuntimeKind: model?.runtimeKind ?? null,
  modelProviderId: model?.providerId ?? null,
  modelId: model?.modelId ?? null,
  modelVariant: model?.variant ?? null,
  modelProfileId: model?.profileId ?? null,
  modelSpeed: model?.speed ?? null,
});

export const readTaskLabels = (session: HostDatabaseSession, workspaceId: string, taskId: string) =>
  session
    .execute(
      (db) =>
        db
          .select()
          .from(taskLabels)
          .where(taskRelationScope(taskLabels, workspaceId, taskId))
          .orderBy(asc(taskLabels.position)),
      "taskRelations.labels",
    )
    .pipe(Effect.map((rows) => normalizeLabels(rows.map((row) => row.label))));

export const replaceTaskLabels = (
  session: HostDatabaseSession,
  workspaceId: string,
  taskId: string,
  labels: readonly string[],
) =>
  Effect.gen(function* () {
    yield* session.execute(
      (db) => db.delete(taskLabels).where(taskRelationScope(taskLabels, workspaceId, taskId)),
      "taskRelations.clearLabels",
    );
    for (const rows of sqliteBatches(
      labels.map((label, position) => ({ workspaceId, taskId, position, label })),
      4,
    ))
      yield* session.execute(
        (db) => db.insert(taskLabels).values(rows),
        "taskRelations.writeLabels",
      );
  });

export const readTaskSessions = (
  session: HostDatabaseSession,
  workspaceId: string,
  taskId: string,
) =>
  readTaskSessionsWithPositions(session, workspaceId, taskId).pipe(
    Effect.map((rows) => rows.map(({ record }) => record)),
  );

export const readTaskSessionsWithPositions = (
  session: HostDatabaseSession,
  workspaceId: string,
  taskId: string,
) =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (db) =>
        db
          .select()
          .from(taskSessions)
          .where(taskRelationScope(taskSessions, workspaceId, taskId))
          .orderBy(desc(taskSessions.startedAt), asc(taskSessions.position)),
      "taskRelations.sessions",
    );
    return yield* Effect.forEach(rows, (row) =>
      taskSessionFromRow(row).pipe(Effect.map((record) => ({ position: row.position, record }))),
    );
  });

export const replaceTaskSessions = (
  session: HostDatabaseSession,
  workspaceId: string,
  taskId: string,
  records: readonly AgentSessionRecord[],
) =>
  Effect.gen(function* () {
    const rows = yield* Effect.forEach(records, (record, position) =>
      taskSessionToRow(workspaceId, taskId, position, record),
    );
    yield* session.execute(
      (db) => db.delete(taskSessions).where(taskRelationScope(taskSessions, workspaceId, taskId)),
      "taskRelations.clearSessions",
    );
    if (rows.length > 0)
      yield* session.execute(
        (db) => db.insert(taskSessions).values(rows),
        "taskRelations.writeSessions",
      );
  });

export const readTaskSessionsForTasks = (
  session: HostDatabaseSession,
  workspaceId: string,
  taskIds: readonly string[],
) =>
  Effect.gen(function* () {
    const result = new Map<string, AgentSessionRecord[]>(taskIds.map((taskId) => [taskId, []]));
    if (taskIds.length === 0) return result;
    const rows = yield* session.execute(
      (db) =>
        db
          .select()
          .from(taskSessions)
          .where(
            and(
              eq(taskSessions.workspaceId, workspaceId),
              inArray(taskSessions.taskId, sqliteValues([...taskIds])),
            ),
          )
          .orderBy(desc(taskSessions.startedAt), asc(taskSessions.position)),
      "taskRelations.sessionBatch",
    );
    for (const row of rows) result.get(row.taskId)?.push(yield* taskSessionFromRow(row));
    return result;
  });

type StoredSessionModel = {
  runtimeKind: string;
  providerId: string | null;
  modelId: string | null;
  variant?: string;
  profileId?: string;
  speed?: string;
};

const selectedModelFromColumns = (row: {
  modelRuntimeKind: string | null;
  modelProviderId: string | null;
  modelId: string | null;
  modelVariant: string | null;
  modelProfileId: string | null;
  modelSpeed: string | null;
}) => {
  if (row.modelRuntimeKind === null) return null;
  const model: StoredSessionModel = {
    runtimeKind: row.modelRuntimeKind,
    providerId: row.modelProviderId,
    modelId: row.modelId,
  };
  if (row.modelVariant !== null) model.variant = row.modelVariant;
  if (row.modelProfileId !== null) model.profileId = row.modelProfileId;
  if (row.modelSpeed !== null) model.speed = row.modelSpeed;
  return model;
};

const taskSessionToRow = (
  workspaceId: string,
  taskId: string,
  position: number,
  record: AgentSessionRecord,
) =>
  Effect.gen(function* () {
    const value = yield* validateWithSchema(agentSessionRecordSchema, record, "task session", {
      workspaceId,
      taskId,
      position,
      externalSessionId: record.externalSessionId,
    });
    if (value.lastActivityAt !== undefined && !Number.isSafeInteger(value.lastActivityAt))
      return yield* new SqliteTaskStoreDataError({
        field: "lastActivityAt",
        message: "Session activity must be a nonnegative safe integer in milliseconds.",
        details: { workspaceId, taskId, position, externalSessionId: record.externalSessionId },
      });
    const instant = parseAgentSessionStartedAt(value.startedAt);
    if (!instant.success)
      return yield* new SqliteTaskStoreDataError({
        field: "startedAt",
        message: instant.message,
        details: { workspaceId, taskId, position, externalSessionId: record.externalSessionId },
      });
    return {
      workspaceId,
      taskId,
      position,
      externalSessionId: record.externalSessionId,
      role: value.role,
      runtimeKind: value.runtimeKind,
      workingDirectory: record.workingDirectory,
      startedAt: instant.milliseconds,
      lastActivityAt: value.lastActivityAt ?? null,
      ...selectedModelColumns(value.selectedModel),
    };
  });

const taskSessionFromRow = (row: TaskSessionRow) =>
  Effect.gen(function* () {
    if (!Number.isInteger(row.startedAt) || Math.abs(row.startedAt) > 8640000000000000)
      return yield* new SqliteTaskStoreDataError({
        field: "startedAt",
        message: "Stored task session start time is invalid. Restore a valid database backup.",
        details: {
          workspaceId: row.workspaceId,
          taskId: row.taskId,
          position: row.position,
          externalSessionId: row.externalSessionId,
        },
      });
    const record = yield* validateWithSchema(
      agentSessionRecordSchema,
      {
        externalSessionId: row.externalSessionId,
        role: row.role,
        runtimeKind: row.runtimeKind,
        workingDirectory: row.workingDirectory,
        startedAt: new Date(row.startedAt).toISOString(),
        lastActivityAt: row.lastActivityAt ?? undefined,
        selectedModel: selectedModelFromColumns(row),
      },
      "task session",
      {
        workspaceId: row.workspaceId,
        taskId: row.taskId,
        position: row.position,
        externalSessionId: row.externalSessionId,
      },
    );
    return {
      ...record,
      externalSessionId: row.externalSessionId,
      workingDirectory: row.workingDirectory,
    };
  });
