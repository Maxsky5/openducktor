import { assertRuntimeOwnershipScope } from "./sqlite-runtime-ownership-scope";
import { listRuntimeSessionOwners } from "./sqlite-runtime-session-owners";
import { type AgentSessionRecord, type TaskAgentSessions } from "@openducktor/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { sqliteValues } from "./sqlite-parameters";
import { hasSameAgentSessionIdentity } from "../../domain/agent-session-identity";
import { compactAgentSessionRecord } from "../../domain/agent-session-records";
import { HostResourceError } from "../../effect/host-errors";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import {
  readTaskSessions,
  readTaskSessionsForTasks,
  readTaskSessionsWithPositions,
  replaceTaskSessions,
  selectedModelColumns,
  taskRelationScope,
} from "./sqlite-task-relations";
import { requireTaskRow } from "./sqlite-task-queries";
import {
  SqliteTaskStoreDataError,
  type SqliteTaskStoreReadError,
  type SqliteTaskStoreWriteError,
} from "./sqlite-task-store-errors";
import { type HostDatabaseSession, taskSessions, tasks } from "./sqlite-host-database-schema";

const compactAgentSessionForStorage = (
  session: AgentSessionRecord,
): Effect.Effect<AgentSessionRecord, SqliteTaskStoreDataError> => {
  const compacted = compactAgentSessionRecord(session);
  if (compacted.success) {
    return Effect.succeed(compacted.session);
  }

  return Effect.fail(
    new SqliteTaskStoreDataError({
      message: compacted.error.message,
      field: compacted.error.field === "agentSession" ? "agentSessionsJson" : compacted.error.field,
    }),
  );
};

export const listAgentSessionsForTasks = (
  session: HostDatabaseSession,
  workspaceId: string,
  input: Parameters<TaskStorePort["listAgentSessionsForTasks"]>[0],
): Effect.Effect<TaskAgentSessions[], SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (database) =>
        database
          .select({
            id: tasks.id,
          })
          .from(tasks)
          .where(
            and(eq(tasks.workspaceId, workspaceId), inArray(tasks.id, sqliteValues(input.taskIds))),
          ),
      "sqliteTaskRepository.listAgentSessionsForTasks.selectTasks",
      { taskIds: input.taskIds },
    );
    const rowsByTaskId = new Map(rows.map((row) => [row.id, row]));
    const sessionsByTask = yield* readTaskSessionsForTasks(session, workspaceId, input.taskIds);
    const results: TaskAgentSessions[] = [];
    for (const taskId of input.taskIds) {
      const row = rowsByTaskId.get(taskId);
      if (!row) {
        return yield* new HostResourceError({
          resource: "task",
          operation: "sqliteTaskRepository.listAgentSessionsForTasks",
          message: `Task not found: ${taskId}`,
          details: { repoPath: input.repoPath, taskId },
        });
      }
      results.push({
        taskId,
        agentSessions: sessionsByTask.get(row.id) ?? [],
      });
    }
    return results;
  });

/** Save a root's event time without changing the task's edit time. */
export const recordAgentSessionActivity = (
  session: HostDatabaseSession,
  workspaceId: string,
  input: Parameters<TaskStorePort["recordAgentSessionActivity"]>[0],
): Effect.Effect<(TaskAgentSessions & { workspaceId: string }) | null, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    if (!Number.isSafeInteger(input.occurredAt) || input.occurredAt < 0) {
      return yield* new SqliteTaskStoreDataError({
        field: "lastActivityAt",
        message: "Session activity requires an epoch timestamp in milliseconds.",
      });
    }
    // Live events can spell the same path differently; the shared identity check owns path matching.
    const candidates = yield* session.execute(
      (database) =>
        database
          .selectDistinct({ id: taskSessions.taskId })
          .from(taskSessions)
          .where(
            and(
              eq(taskSessions.workspaceId, workspaceId),
              eq(taskSessions.runtimeKind, input.identity.runtimeKind),
              eq(taskSessions.externalSessionId, input.identity.externalSessionId),
            ),
          ),
      "sqliteTaskRepository.recordAgentSessionActivity.findOwner",
    );
    const rows = candidates;
    let owner: {
      taskId: string;
      sessions: AgentSessionRecord[];
      stored: AgentSessionRecord;
      position: number;
    } | null = null;
    for (const row of rows) {
      const sessions = yield* readTaskSessionsWithPositions(session, workspaceId, row.id);
      const stored = sessions.find(({ record }) =>
        hasSameAgentSessionIdentity(record, input.identity),
      );
      if (!stored) continue;
      if (owner) {
        return yield* new SqliteTaskStoreDataError({
          field: "agentSessionsJson",
          message: `More than one task owns session '${input.identity.externalSessionId}'.`,
        });
      }
      owner = {
        taskId: row.id,
        sessions: sessions.map(({ record }) => record),
        stored: stored.record,
        position: stored.position,
      };
    }
    if (!owner) return null;
    const { taskId, sessions, stored, position } = owner;
    if (input.occurredAt <= (stored.lastActivityAt ?? Date.parse(stored.startedAt))) return null;
    const next = sessions.map((record) =>
      record === stored ? { ...record, lastActivityAt: input.occurredAt } : record,
    );
    yield* session.execute(
      (database) =>
        database
          .update(taskSessions)
          .set({ lastActivityAt: input.occurredAt })
          .where(
            and(
              eq(taskSessions.workspaceId, workspaceId),
              eq(taskSessions.taskId, taskId),
              eq(taskSessions.position, position),
            ),
          ),
      "sqliteTaskRepository.recordAgentSessionActivity.updateSession",
    );
    return { workspaceId, taskId, agentSessions: next };
  });

export const clearAgentSessionsByRoles = (
  session: HostDatabaseSession,
  workspaceId: string,
  input: Parameters<TaskStorePort["clearAgentSessionsByRoles"]>[0],
  updatedAt: Date,
): Effect.Effect<boolean, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const row = yield* requireTaskRow(session, workspaceId, input.taskId, input.repoPath);
    const roleSet = new Set(input.roles.map((role) => role.trim()).filter(Boolean));
    if (roleSet.size === 0) {
      return true;
    }
    const sessions = yield* readTaskSessionsWithPositions(session, workspaceId, row.id);
    const matches = sessions.filter(({ record }) => roleSet.has(record.role.trim()));
    if (matches.length > 0)
      yield* session.execute(
        (db) =>
          db
            .delete(taskSessions)
            .where(
              and(
                taskRelationScope(taskSessions, workspaceId, input.taskId),
                inArray(
                  taskSessions.position,
                  sqliteValues(matches.map(({ position }) => position)),
                ),
              ),
            ),
        "sqliteTaskRepository.clearAgentSessionsByRoles.deleteSessions",
      );
    yield* session.execute(
      (db) =>
        db
          .update(tasks)
          .set({ updatedAt })
          .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, input.taskId))),
      "sqliteTaskRepository.clearAgentSessionsByRoles.updateTask",
    );
    return true;
  });

export const upsertAgentSession = (
  session: HostDatabaseSession,
  workspaceId: string,
  input: Parameters<TaskStorePort["upsertAgentSession"]>[0],
  updatedAt: Date,
): Effect.Effect<boolean, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const compactSession = yield* compactAgentSessionForStorage(input.session);
    const row = yield* requireTaskRow(session, workspaceId, input.taskId, input.repoPath);
    const sessions = yield* readTaskSessions(session, workspaceId, row.id);
    const existingIndex = sessions.findIndex((entry) =>
      hasSameAgentSessionIdentity(entry, compactSession),
    );
    if (existingIndex < 0) {
      if (!input.ownershipScope)
        return yield* new SqliteTaskStoreDataError({
          field: "ownershipScope",
          message:
            "Resolve the current repository ownership scope before linking a new task session.",
        });
      const workspaceIds = yield* assertRuntimeOwnershipScope(session, input.ownershipScope, {
        workspaceId,
        repoPath: input.repoPath,
      });
      const owner = (yield* listRuntimeSessionOwners(session, workspaceIds, {
        runtimeKind: compactSession.runtimeKind,
        externalSessionIds: [compactSession.externalSessionId],
      })).find(
        (owner) =>
          owner.runtimeKind === compactSession.runtimeKind &&
          owner.externalSessionId === compactSession.externalSessionId &&
          !(
            owner.kind === "task" &&
            owner.workspaceId === workspaceId &&
            owner.taskId === input.taskId
          ),
      );
      if (owner)
        return yield* new SqliteTaskStoreDataError({
          field: "externalSessionId",
          message: `This runtime conversation already belongs to ${owner.kind === "task" ? `task ${owner.taskId}` : "a workspace session"} in workspace ${owner.workspaceId}. Open it from its owner.`,
        });
    }
    if (existingIndex >= 0) {
      const stored = sessions[existingIndex];
      sessions[existingIndex] =
        stored?.lastActivityAt === undefined
          ? compactSession
          : {
              ...compactSession,
              lastActivityAt: Math.max(stored.lastActivityAt, compactSession.lastActivityAt ?? 0),
            };
    } else {
      sessions.push(compactSession);
    }
    const nextSessions = sessions
      .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
      .slice(0, 100);
    yield* replaceTaskSessions(session, workspaceId, input.taskId, nextSessions);
    yield* session.execute(
      (db) =>
        db
          .update(tasks)
          .set({ updatedAt })
          .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, input.taskId))),
      "sqliteTaskRepository.upsertAgentSession.updateTask",
    );
    return true;
  });

export const updateAgentSessionModel = (
  session: HostDatabaseSession,
  workspaceId: string,
  input: Parameters<TaskStorePort["updateAgentSessionModel"]>[0],
  updatedAt: Date,
): Effect.Effect<boolean, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const row = yield* requireTaskRow(session, workspaceId, input.taskId, input.repoPath);
    const sessions = yield* readTaskSessionsWithPositions(session, workspaceId, row.id);
    const matches = sessions.filter(({ record }) =>
      hasSameAgentSessionIdentity(record, input.identity),
    );
    const existing = matches[0]?.record;
    if (!existing) {
      return yield* Effect.fail(
        new HostResourceError({
          resource: "task-session",
          operation: "sqliteTaskRepository.updateAgentSessionModel",
          message: `Task session not found: ${input.identity.externalSessionId}`,
          details: {
            repoPath: input.repoPath,
            taskId: input.taskId,
            identity: input.identity,
          },
        }),
      );
    }
    const updated = yield* compactAgentSessionForStorage({
      ...existing,
      selectedModel: input.selectedModel,
    });
    yield* session.execute(
      (db) =>
        db
          .update(taskSessions)
          .set(selectedModelColumns(updated.selectedModel))
          .where(
            and(
              eq(taskSessions.workspaceId, workspaceId),
              eq(taskSessions.taskId, input.taskId),
              inArray(taskSessions.position, sqliteValues(matches.map(({ position }) => position))),
            ),
          ),
      "sqliteTaskRepository.updateAgentSessionModel.updateSessions",
    );
    yield* session.execute(
      (db) =>
        db
          .update(tasks)
          .set({ updatedAt })
          .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, input.taskId))),
      "sqliteTaskRepository.updateAgentSessionModel.updateTask",
    );
    return true;
  });

export const deleteAgentSession = (
  session: HostDatabaseSession,
  workspaceId: string,
  input: Parameters<TaskStorePort["deleteAgentSession"]>[0],
  updatedAt: Date,
): Effect.Effect<boolean, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const row = yield* requireTaskRow(session, workspaceId, input.taskId, input.repoPath);
    const sessions = yield* readTaskSessionsWithPositions(session, workspaceId, row.id);
    const matches = sessions.filter(({ record }) =>
      hasSameAgentSessionIdentity(record, input.identity),
    );
    if (matches.length === 0) {
      return true;
    }
    yield* session.execute(
      (db) =>
        db
          .delete(taskSessions)
          .where(
            and(
              taskRelationScope(taskSessions, workspaceId, input.taskId),
              inArray(taskSessions.position, sqliteValues(matches.map(({ position }) => position))),
            ),
          ),
      "sqliteTaskRepository.deleteAgentSession.deleteSessions",
    );
    yield* session.execute(
      (db) =>
        db
          .update(tasks)
          .set({ updatedAt })
          .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, input.taskId))),
      "sqliteTaskRepository.deleteAgentSession.updateTask",
    );
    return true;
  });
