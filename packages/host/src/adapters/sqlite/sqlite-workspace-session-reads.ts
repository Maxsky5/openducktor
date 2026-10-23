import { workspaceSessionSchema } from "@openducktor/contracts";
import { desc, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { TaskStoreSession } from "./sqlite-task-store-schema";
import { type WorkspaceSessionRow, workspaceSessions } from "./sqlite-workspace-session-schema";

export const readActiveWorkspaceSessions = (session: TaskStoreSession) =>
  readWorkspaceSessions(session, true);

export const readWorkspaceSessionsForWorktreeOwnership = (session: TaskStoreSession) =>
  readWorkspaceSessions(session, false);

export const decodeRecord = (row: WorkspaceSessionRow) =>
  Effect.try({
    try: () =>
      workspaceSessionSchema.parse({
        id: row.id,
        runtimeKind: row.runtimeKind,
        externalSessionId: row.externalSessionId,
        executionTarget: JSON.parse(row.executionTargetJson),
        roleSnapshot: row.roleSnapshotJson === null ? null : JSON.parse(row.roleSnapshotJson),
        selectedModel: row.selectedModelJson === null ? null : JSON.parse(row.selectedModelJson),
        generatedTitle: row.generatedTitle,
        manualTitle: row.manualTitle,
        targetBranch: row.targetBranchJson === null ? null : JSON.parse(row.targetBranchJson),
        createdAt: row.createdAt,
        lastActivityAt: row.lastActivityAt ?? undefined,
        updatedAt: row.updatedAt,
        archivedAt: row.archivedAt,
      }),
    catch: (cause) =>
      new HostValidationError({
        message: `Stored Workspace Session ${row.id} is invalid.`,
        cause,
      }),
  });

const readWorkspaceSessions = (session: TaskStoreSession, activeOnly: boolean) =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (database) =>
        database
          .select()
          .from(workspaceSessions)
          .where(activeOnly ? isNull(workspaceSessions.archivedAt) : undefined)
          .orderBy(desc(workspaceSessions.updatedAt)),
      activeOnly ? "workspaceSessionStore.listActive" : "workspaceSessionStore.worktreeOwners",
    );
    return yield* Effect.forEach(rows, decodeRecord);
  });
