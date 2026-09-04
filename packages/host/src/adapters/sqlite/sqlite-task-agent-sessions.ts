import { type AgentSessionRecord, type TaskAgentSessions } from "@openducktor/contracts";
import { eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { hasSameAgentSessionIdentity } from "../../domain/agent-session-identity";
import { compactAgentSessionRecord } from "../../domain/agent-session-records";
import { HostResourceError } from "../../effect/host-errors";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import { agentSessionsFromRow, encodeJson } from "./sqlite-json-codecs";
import { requireTaskRow } from "./sqlite-task-queries";
import {
  SqliteTaskStoreDataError,
  type SqliteTaskStoreReadError,
  type SqliteTaskStoreWriteError,
} from "./sqlite-task-store-errors";
import { type TaskStoreSession, tasks } from "./sqlite-task-store-schema";

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
  session: TaskStoreSession,
  input: Parameters<TaskStorePort["listAgentSessionsForTasks"]>[0],
): Effect.Effect<TaskAgentSessions[], SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (database) =>
        database
          .select({
            id: tasks.id,
            agentSessionsJson: tasks.agentSessionsJson,
          })
          .from(tasks)
          .where(inArray(tasks.id, input.taskIds)),
      "sqliteTaskRepository.listAgentSessionsForTasks.selectTasks",
      { taskIds: input.taskIds },
    );
    const rowsByTaskId = new Map(rows.map((row) => [row.id, row]));
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
        agentSessions: yield* agentSessionsFromRow(row),
      });
    }
    return results;
  });

export const clearAgentSessionsByRoles = (
  session: TaskStoreSession,
  input: Parameters<TaskStorePort["clearAgentSessionsByRoles"]>[0],
  updatedAt: Date,
): Effect.Effect<boolean, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const row = yield* requireTaskRow(session, input.taskId, input.repoPath);
    const roleSet = new Set(input.roles.map((role) => role.trim()).filter(Boolean));
    if (roleSet.size === 0) {
      return true;
    }
    const sessions = yield* agentSessionsFromRow(row);
    const remaining = sessions.filter((session) => !roleSet.has(session.role.trim()));
    yield* session.execute(
      (database) =>
        database
          .update(tasks)
          .set({
            agentSessionsJson: encodeJson(z.json().parse(remaining)),
            updatedAt,
          })
          .where(eq(tasks.id, input.taskId)),
      "sqliteTaskRepository.clearAgentSessionsByRoles.updateTask",
    );
    return true;
  });

export const upsertAgentSession = (
  session: TaskStoreSession,
  input: Parameters<TaskStorePort["upsertAgentSession"]>[0],
  updatedAt: Date,
): Effect.Effect<boolean, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const compactSession = yield* compactAgentSessionForStorage(input.session);
    const row = yield* requireTaskRow(session, input.taskId, input.repoPath);
    const sessions = yield* agentSessionsFromRow(row);
    const existingIndex = sessions.findIndex((entry) =>
      hasSameAgentSessionIdentity(entry, compactSession),
    );
    if (existingIndex >= 0) {
      sessions[existingIndex] = compactSession;
    } else {
      sessions.push(compactSession);
    }
    const nextSessions = sessions
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .slice(0, 100);
    yield* session.execute(
      (database) =>
        database
          .update(tasks)
          .set({
            agentSessionsJson: encodeJson(z.json().parse(nextSessions)),
            updatedAt,
          })
          .where(eq(tasks.id, input.taskId)),
      "sqliteTaskRepository.upsertAgentSession.updateTask",
    );
    return true;
  });

export const updateAgentSessionModel = (
  session: TaskStoreSession,
  input: Parameters<TaskStorePort["updateAgentSessionModel"]>[0],
  updatedAt: Date,
): Effect.Effect<boolean, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const row = yield* requireTaskRow(session, input.taskId, input.repoPath);
    const sessions = yield* agentSessionsFromRow(row);
    const existing = sessions.find((entry) => hasSameAgentSessionIdentity(entry, input.identity));
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
    const nextSessions = sessions.map((entry) =>
      hasSameAgentSessionIdentity(entry, input.identity) ? updated : entry,
    );
    yield* session.execute(
      (database) =>
        database
          .update(tasks)
          .set({
            agentSessionsJson: encodeJson(z.json().parse(nextSessions)),
            updatedAt,
          })
          .where(eq(tasks.id, input.taskId)),
      "sqliteTaskRepository.updateAgentSessionModel.updateTask",
    );
    return true;
  });

export const deleteAgentSession = (
  session: TaskStoreSession,
  input: Parameters<TaskStorePort["deleteAgentSession"]>[0],
  updatedAt: Date,
): Effect.Effect<boolean, SqliteTaskStoreWriteError> =>
  Effect.gen(function* () {
    const row = yield* requireTaskRow(session, input.taskId, input.repoPath);
    const sessions = yield* agentSessionsFromRow(row);
    const remaining = sessions.filter(
      (entry) => !hasSameAgentSessionIdentity(entry, input.identity),
    );
    if (remaining.length === sessions.length) {
      return true;
    }
    yield* session.execute(
      (database) =>
        database
          .update(tasks)
          .set({
            agentSessionsJson: encodeJson(z.json().parse(remaining)),
            updatedAt,
          })
          .where(eq(tasks.id, input.taskId)),
      "sqliteTaskRepository.deleteAgentSession.updateTask",
    );
    return true;
  });
