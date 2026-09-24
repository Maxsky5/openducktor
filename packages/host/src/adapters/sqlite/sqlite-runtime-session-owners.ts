import { runtimeKindSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { SqliteTaskStoreDataError } from "./sqlite-task-store-errors";
import type { RuntimeSessionOwner } from "../../ports/workspace-session-store-port";
import { agentSessionsFromRow } from "./sqlite-json-codecs";
import { tasks, type TaskStoreSession } from "./sqlite-task-store-schema";
import { workspaceSessions } from "./sqlite-workspace-session-schema";

export const listRuntimeSessionOwners = (session: TaskStoreSession) =>
  Effect.gen(function* () {
    const chats = yield* session.execute(
      (db) => db.select().from(workspaceSessions),
      "runtimeSessionOwners.chats",
    );
    const taskRows = yield* session.execute(
      (db) => db.select({ id: tasks.id, agentSessionsJson: tasks.agentSessionsJson }).from(tasks),
      "runtimeSessionOwners.tasks",
    );
    const owners: RuntimeSessionOwner[] = [];
    for (const row of chats) {
      if (row.externalSessionId === null) continue;
      const runtimeKind = yield* Effect.try({
        try: () => runtimeKindSchema.parse(row.runtimeKind),
        catch: (cause) =>
          new SqliteTaskStoreDataError({
            field: "runtimeKind",
            message: "Invalid runtime kind in a workspace chat.",
            cause,
          }),
      });
      owners.push({
        kind: "workspace",
        runtimeKind,
        externalSessionId: row.externalSessionId,
        sessionId: row.id,
        archived: row.archivedAt !== null,
      });
    }
    for (const row of taskRows) {
      for (const record of yield* agentSessionsFromRow(row)) {
        owners.push({
          kind: "task",
          taskId: row.id,
          role: record.role,
          runtimeKind: record.runtimeKind,
          externalSessionId: record.externalSessionId,
        });
      }
    }
    return owners;
  });
