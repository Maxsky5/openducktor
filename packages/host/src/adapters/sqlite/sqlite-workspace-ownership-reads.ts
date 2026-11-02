import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";
import type {
  TaskOwnershipReader,
  TaskWorktreeDirectories,
} from "../../ports/task-repository-ports";
import type {
  LiveSessionRoot,
  WorkspaceSessionStoreScope,
  WorktreeOwnershipChat,
} from "../../ports/workspace-session-store-port";
import { sqliteValues } from "./sqlite-parameters";
import { parseSavedRuntimeKind } from "./sqlite-runtime-session-owners";
import type { SqliteTaskStoreDataError } from "./sqlite-task-store-errors";
import {
  readWorkspaceSet,
  type SqliteWorkspacesReadProvider,
} from "./sqlite-task-repository-context";
import { type HostDatabaseSession, taskSessions, tasks } from "./sqlite-host-database-schema";
import { workspaceSessions } from "./sqlite-workspace-session-schema";

// Each read takes the workspaces that its caller admitted and reads all of them in one query.

const notTerminal = (status: AnySQLiteColumn, terminalStates: readonly string[]) =>
  terminalStates.length === 0 ? undefined : notInArray(status, sqliteValues(terminalStates));

/** Reads the saved chats of the workspaces, archived chats included. */
export const readWorktreeOwnershipChats = (
  session: HostDatabaseSession,
  workspaceIds: readonly string[],
) =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (db) =>
        db
          .select({
            workspaceId: workspaceSessions.workspaceId,
            id: workspaceSessions.id,
            runtimeKind: workspaceSessions.runtimeKind,
            externalSessionId: workspaceSessions.externalSessionId,
            workingDirectory: workspaceSessions.workingDirectory,
            generatedTitle: workspaceSessions.generatedTitle,
            manualTitle: workspaceSessions.manualTitle,
            archivedAt: workspaceSessions.archivedAt,
          })
          .from(workspaceSessions)
          .where(inArray(workspaceSessions.workspaceId, sqliteValues(workspaceIds)))
          .orderBy(asc(workspaceSessions.workspaceId), desc(workspaceSessions.updatedAt)),
      "workspaceSessionStore.worktreeOwners",
    );
    return yield* Effect.forEach(
      rows,
      (row): Effect.Effect<WorktreeOwnershipChat, SqliteTaskStoreDataError> =>
        parseSavedRuntimeKind(row.runtimeKind).pipe(
          Effect.map((runtimeKind) => ({ ...row, runtimeKind })),
        ),
    );
  });

/** Reads tasks with the trimmed working directories of their sessions, without terminal tasks. */
const readTaskWorktreeDirectories = (
  session: HostDatabaseSession,
  workspaceIds: readonly string[],
  terminalStates: readonly string[],
) =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (db) =>
        db
          .select({
            workspaceId: tasks.workspaceId,
            taskId: tasks.id,
            title: tasks.title,
            workingDirectory: taskSessions.workingDirectory,
          })
          .from(tasks)
          .leftJoin(
            taskSessions,
            and(eq(taskSessions.workspaceId, tasks.workspaceId), eq(taskSessions.taskId, tasks.id)),
          )
          .where(
            and(
              inArray(tasks.workspaceId, sqliteValues(workspaceIds)),
              notTerminal(tasks.status, terminalStates),
            ),
          )
          .orderBy(
            asc(tasks.workspaceId),
            asc(tasks.id),
            desc(taskSessions.startedAt),
            asc(taskSessions.position),
          ),
      "taskStore.worktreeOwners",
    );
    const byTask = new Map<string, TaskWorktreeDirectories & { workspaceId: string }>();
    for (const row of rows) {
      const key = JSON.stringify([row.workspaceId, row.taskId]);
      let task = byTask.get(key);
      if (!task) {
        task = {
          workspaceId: row.workspaceId,
          taskId: row.taskId,
          title: row.title,
          sessionDirectories: [],
        };
        byTask.set(key, task);
      }
      const directory = row.workingDirectory?.trim();
      if (directory) task.sessionDirectories.push(directory);
    }
    return [...byTask.values()];
  });

/** Reads the native conversations of active chats and of tasks that are not terminal. */
export const readLiveSessionRoots = (
  session: HostDatabaseSession,
  workspaceIds: readonly string[],
  terminalStates: readonly string[],
) =>
  Effect.gen(function* () {
    const chats = yield* session.execute(
      (db) =>
        db
          .select({
            workspaceId: workspaceSessions.workspaceId,
            runtimeKind: workspaceSessions.runtimeKind,
            // The filter below drops chats without a native conversation.
            externalSessionId: sql<string>`${workspaceSessions.externalSessionId}`,
            workingDirectory: workspaceSessions.workingDirectory,
          })
          .from(workspaceSessions)
          .where(
            and(
              inArray(workspaceSessions.workspaceId, sqliteValues(workspaceIds)),
              isNull(workspaceSessions.archivedAt),
              isNotNull(workspaceSessions.externalSessionId),
            ),
          )
          .orderBy(asc(workspaceSessions.workspaceId), desc(workspaceSessions.updatedAt)),
      "workspaceSessionStore.liveRoots.chats",
    );
    const taskRoots = yield* session.execute(
      (db) =>
        db
          .select({
            workspaceId: taskSessions.workspaceId,
            taskId: taskSessions.taskId,
            role: taskSessions.role,
            runtimeKind: taskSessions.runtimeKind,
            externalSessionId: taskSessions.externalSessionId,
            workingDirectory: taskSessions.workingDirectory,
          })
          .from(taskSessions)
          .innerJoin(
            tasks,
            and(eq(tasks.workspaceId, taskSessions.workspaceId), eq(tasks.id, taskSessions.taskId)),
          )
          .where(
            and(
              inArray(taskSessions.workspaceId, sqliteValues(workspaceIds)),
              notTerminal(tasks.status, terminalStates),
            ),
          )
          .orderBy(
            asc(taskSessions.workspaceId),
            asc(taskSessions.taskId),
            desc(taskSessions.startedAt),
            asc(taskSessions.position),
          ),
      "workspaceSessionStore.liveRoots.tasks",
    );
    const roots: LiveSessionRoot[] = [];
    for (const { workspaceId, runtimeKind, externalSessionId, workingDirectory } of chats)
      roots.push({
        sessionScope: { kind: "repository", workspaceId },
        runtimeKind: yield* parseSavedRuntimeKind(runtimeKind),
        externalSessionId,
        workingDirectory,
      });
    for (const { workspaceId, taskId, role, runtimeKind, ...root } of taskRoots)
      roots.push({
        sessionScope: { kind: "workflow", workspaceId, taskId, role },
        runtimeKind: yield* parseSavedRuntimeKind(runtimeKind),
        ...root,
      });
    return roots;
  });

/** Reads the tasks that can own a worktree. Removal reads them in every registered state. */
export const createSqliteTaskOwnershipReader = (
  readWorkspaces: SqliteWorkspacesReadProvider,
): TaskOwnershipReader => {
  const read = (
    workspaces: readonly WorkspaceSessionStoreScope[],
    access: "administrative" | "ownership",
    includeTerminalTasks: boolean,
    operation: string,
  ) =>
    readWorkspaceSet(readWorkspaces, workspaces, access, operation, (context) =>
      readTaskWorktreeDirectories(
        context.session,
        context.workspaceIds,
        includeTerminalTasks ? [] : context.terminalStates,
      ),
    );
  return {
    listTaskDirectoriesForWorktreeOwnership: ({ workspaces }) =>
      read(workspaces, "administrative", true, "taskStore.worktreeClaims"),
    listOpenTasksForWorktreeOwnership: ({ workspaces }) =>
      read(workspaces, "ownership", false, "taskStore.worktreeOwners"),
  };
};
