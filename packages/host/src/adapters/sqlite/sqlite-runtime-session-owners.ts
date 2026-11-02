import { sqliteValues } from "./sqlite-parameters";
import { runtimeKindSchema } from "@openducktor/contracts";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Effect } from "effect";
import { SqliteTaskStoreDataError } from "./sqlite-task-store-errors";
import type {
  RuntimeSessionOwner,
  RuntimeOwnerFilter,
} from "../../ports/workspace-session-store-port";

import { taskSessions, type HostDatabaseSession } from "./sqlite-host-database-schema";
import { workspaceSessions } from "./sqlite-workspace-session-schema";

export const parseSavedRuntimeKind = (value: string) =>
  Effect.try({
    try: () => runtimeKindSchema.parse(value),
    catch: (cause) =>
      new SqliteTaskStoreDataError({
        field: "runtimeKind",
        message: "Invalid runtime kind in a saved session.",
        cause,
      }),
  });

export const listRuntimeSessionOwners = (
  session: HostDatabaseSession,
  workspaceIds: readonly string[],
  filter?: RuntimeOwnerFilter,
) =>
  Effect.gen(function* () {
    if (workspaceIds.length === 0 || filter?.externalSessionIds.length === 0) return [];
    const rows = yield* session.execute(
      (db) =>
        db
          .select({
            workspaceId: workspaceSessions.workspaceId,
            runtimeKind: workspaceSessions.runtimeKind,
            externalSessionId: workspaceSessions.externalSessionId,
            ownerId: workspaceSessions.id,
            archived: sql<boolean>`${workspaceSessions.archivedAt} is not null`.mapWith(Boolean),
            role: sql<string | null>`null`,
          })
          .from(workspaceSessions)
          .where(
            and(
              inArray(workspaceSessions.workspaceId, sqliteValues([...workspaceIds])),
              isNotNull(workspaceSessions.externalSessionId),
              filter && eq(workspaceSessions.runtimeKind, filter.runtimeKind),
              filter &&
                inArray(
                  workspaceSessions.externalSessionId,
                  sqliteValues(filter.externalSessionIds),
                ),
            ),
          )
          .unionAll(
            db
              .select({
                workspaceId: taskSessions.workspaceId,
                runtimeKind: taskSessions.runtimeKind,
                externalSessionId: taskSessions.externalSessionId,
                ownerId: taskSessions.taskId,
                archived: sql<boolean>`0`.mapWith(Boolean),
                role: taskSessions.role,
              })
              .from(taskSessions)
              .where(
                and(
                  inArray(taskSessions.workspaceId, sqliteValues([...workspaceIds])),
                  filter && eq(taskSessions.runtimeKind, filter.runtimeKind),
                  filter &&
                    inArray(
                      taskSessions.externalSessionId,
                      sqliteValues(filter.externalSessionIds),
                    ),
                ),
              ),
          ),
      "runtimeSessionOwners.list",
    );
    const owners: (RuntimeSessionOwner & { workspaceId: string })[] = [];
    for (const row of rows) {
      if (row.externalSessionId === null) continue;
      const runtimeKind = yield* parseSavedRuntimeKind(row.runtimeKind);
      owners.push({
        workspaceId: row.workspaceId,
        runtimeKind,
        externalSessionId: row.externalSessionId,
        ...(row.role === null
          ? { kind: "workspace", sessionId: row.ownerId, archived: row.archived }
          : { kind: "task", taskId: row.ownerId, role: row.role }),
      });
    }
    return owners;
  });
