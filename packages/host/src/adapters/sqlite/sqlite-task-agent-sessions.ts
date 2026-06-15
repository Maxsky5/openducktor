import { type AgentSessionRecord, agentSessionRecordSchema } from "@openducktor/contracts";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import { agentSessionsFromRow, encodeJson } from "./sqlite-json-codecs";
import { requireTaskRow } from "./sqlite-task-queries";
import {
  SqliteTaskStoreDataError,
  type SqliteTaskStoreWriteError,
} from "./sqlite-task-store-errors";
import { type TaskStoreSession, tasks } from "./sqlite-task-store-schema";

const requireTrimmed = (
  value: string,
  field: string,
): Effect.Effect<string, SqliteTaskStoreDataError> => {
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    return Effect.succeed(trimmed);
  }
  return Effect.fail(
    new SqliteTaskStoreDataError({
      message: `Agent session ${field} is required.`,
      field,
    }),
  );
};

const compactAgentSessionForStorage = (
  session: AgentSessionRecord,
): Effect.Effect<AgentSessionRecord, SqliteTaskStoreDataError> =>
  Effect.gen(function* () {
    const externalSessionId = yield* requireTrimmed(session.externalSessionId, "externalSessionId");
    const role = yield* requireTrimmed(session.role, "role");
    const startedAt = yield* requireTrimmed(session.startedAt, "startedAt");
    const runtimeKind = yield* requireTrimmed(session.runtimeKind, "runtimeKind");
    const workingDirectory = yield* requireTrimmed(session.workingDirectory, "workingDirectory");
    const selectedModel =
      session.selectedModel === null
        ? null
        : {
            ...session.selectedModel,
            runtimeKind: session.selectedModel.runtimeKind.trim(),
          };
    if (selectedModel !== null && !selectedModel.runtimeKind) {
      return yield* new SqliteTaskStoreDataError({
        message: "Agent session selectedModel.runtimeKind is required.",
        field: "selectedModel.runtimeKind",
      });
    }
    const parsed = agentSessionRecordSchema.safeParse({
      ...session,
      externalSessionId,
      role,
      startedAt,
      runtimeKind,
      workingDirectory,
      selectedModel,
    });
    if (parsed.success) {
      return parsed.data;
    }
    return yield* new SqliteTaskStoreDataError({
      message: `Invalid compacted agent session: ${parsed.error.message}`,
      field: "agentSessionsJson",
    });
  });

const isSameAgentSessionRecordIdentity = (
  left: AgentSessionRecord,
  right: AgentSessionRecord,
): boolean =>
  left.externalSessionId.trim() === right.externalSessionId.trim() &&
  left.runtimeKind.trim() === right.runtimeKind.trim() &&
  normalizePathForComparison(left.workingDirectory) ===
    normalizePathForComparison(right.workingDirectory);

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
      isSameAgentSessionRecordIdentity(entry, compactSession),
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
