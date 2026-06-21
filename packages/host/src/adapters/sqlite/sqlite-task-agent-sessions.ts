import type { AgentSessionRecord } from "@openducktor/contracts";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { hasSameAgentSessionIdentity } from "../../domain/agent-session-identity";
import { compactAgentSessionRecord } from "../../domain/agent-session-records";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import { agentSessionsFromRow, encodeJson } from "./sqlite-json-codecs";
import { requireTaskRow } from "./sqlite-task-queries";
import {
  SqliteTaskStoreDataError,
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
