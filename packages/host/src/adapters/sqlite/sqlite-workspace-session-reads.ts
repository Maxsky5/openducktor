import { selectedModelColumns } from "./sqlite-task-relations";
import { workspaceSessionSchema, type WorkspaceSession } from "@openducktor/contracts";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { HostDatabaseSession } from "./sqlite-host-database-schema";
import { type WorkspaceSessionRow, workspaceSessions } from "./sqlite-workspace-session-schema";

export const workspaceSessionScope = (workspaceId: string, sessionId?: string) =>
  and(
    eq(workspaceSessions.workspaceId, workspaceId),
    sessionId === undefined ? undefined : eq(workspaceSessions.id, sessionId),
  );

export const encodeWorkspaceSessionRecord = (
  workspaceId: string,
  record: WorkspaceSession,
): WorkspaceSessionRow => ({
  workspaceId,
  id: record.id,
  runtimeKind: record.runtimeKind,
  externalSessionId: record.externalSessionId,
  executionKind: record.executionTarget.kind,
  workingDirectory: record.executionTarget.workingDirectory,
  branchName:
    record.executionTarget.kind === "local_worktree" ? record.executionTarget.branchName : null,
  worktreeState:
    record.executionTarget.kind === "local_worktree" ? record.executionTarget.worktreeState : null,
  roleSnapshotId: record.roleSnapshot?.id ?? null,
  roleSnapshotName: record.roleSnapshot?.name ?? null,
  roleSnapshotSystemPrompt: record.roleSnapshot?.systemPrompt ?? null,
  ...selectedModelColumns(record.selectedModel),
  generatedTitle: record.generatedTitle,
  manualTitle: record.manualTitle,
  targetBranch: record.targetBranch?.branch ?? null,
  targetRemote: record.targetBranch?.remote ?? null,
  createdAt: record.createdAt,
  lastActivityAt: record.lastActivityAt ?? null,
  updatedAt: record.updatedAt,
  archivedAt: record.archivedAt,
});

export const decodeRecord = (row: WorkspaceSessionRow) =>
  Effect.try({
    try: () =>
      workspaceSessionSchema.parse({
        id: row.id,
        runtimeKind: row.runtimeKind,
        externalSessionId: row.externalSessionId,
        executionTarget:
          row.executionKind === "local_repo_root"
            ? { kind: row.executionKind, workingDirectory: row.workingDirectory }
            : {
                kind: row.executionKind,
                workingDirectory: row.workingDirectory,
                branchName: row.branchName,
                worktreeState: row.worktreeState,
              },
        roleSnapshot:
          row.roleSnapshotId === null
            ? null
            : {
                id: row.roleSnapshotId,
                name: row.roleSnapshotName,
                systemPrompt: row.roleSnapshotSystemPrompt,
              },
        selectedModel:
          row.modelRuntimeKind === null
            ? null
            : {
                runtimeKind: row.modelRuntimeKind,
                providerId: row.modelProviderId,
                modelId: row.modelId,
                variant: row.modelVariant ?? undefined,
                profileId: row.modelProfileId ?? undefined,
                speed: row.modelSpeed ?? undefined,
              },
        generatedTitle: row.generatedTitle,
        manualTitle: row.manualTitle,
        targetBranch:
          row.targetBranch === null
            ? null
            : {
                branch: row.targetBranch,
                remote: row.targetRemote ?? undefined,
              },
        createdAt: row.createdAt,
        lastActivityAt: row.lastActivityAt ?? undefined,
        updatedAt: row.updatedAt,
        archivedAt: row.archivedAt,
      }),
    catch: (cause) =>
      new HostValidationError({
        message: `Stored workspace session ${row.id} in workspace ${row.workspaceId} is invalid.`,
        cause,
      }),
  });

/** Reads the active saved chats of one workspace, the most recently updated first. */
export const readActiveWorkspaceSessions = (session: HostDatabaseSession, workspaceId: string) =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (database) =>
        database
          .select()
          .from(workspaceSessions)
          .where(and(workspaceSessionScope(workspaceId), isNull(workspaceSessions.archivedAt)))
          .orderBy(desc(workspaceSessions.updatedAt)),
      "workspaceSessionStore.listActive",
    );
    return yield* Effect.forEach(rows, decodeRecord);
  });
