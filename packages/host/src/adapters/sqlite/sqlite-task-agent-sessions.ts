import type { AgentSessionRecord, TaskAgentSessions } from "@openducktor/contracts";
import { eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { hasSameAgentSessionIdentity } from "../../domain/agent-session-identity";
import { compactAgentSessionRecord } from "../../domain/agent-session-records";
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
): Effect.Effect<TaskAgentSessions[], SqliteTaskStoreReadError> => {
  const taskIds = Array.from(new Set(input.taskIds.map((taskId) => taskId.trim()).filter(Boolean)));
  if (taskIds.length === 0) {
    return Effect.succeed([]);
  }

  return Effect.gen(function* () {
    const rows = yield* session.execute(
      (database) => database.select().from(tasks).where(inArray(tasks.id, taskIds)),
      "sqliteTaskRepository.listAgentSessionsForTasks.selectTasks",
      { taskIds },
    );
    const rowsByTaskId = new Map(rows.map((row) => [row.id, row]));
    const results: TaskAgentSessions[] = [];
    for (const taskId of taskIds) {
      const row = rowsByTaskId.get(taskId);
      if (!row) {
        continue;
      }
      results.push({
        taskId,
        agentSessions: yield* agentSessionsFromRow(row),
      });
    }
    return results;
  });
};

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
            agentSessionsJson: encodeJson(remaining),
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
            agentSessionsJson: encodeJson(nextSessions),
            updatedAt,
          })
          .where(eq(tasks.id, input.taskId)),
      "sqliteTaskRepository.upsertAgentSession.updateTask",
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
            agentSessionsJson: encodeJson(remaining),
            updatedAt,
          })
          .where(eq(tasks.id, input.taskId)),
      "sqliteTaskRepository.deleteAgentSession.updateTask",
    );
    return true;
  });
