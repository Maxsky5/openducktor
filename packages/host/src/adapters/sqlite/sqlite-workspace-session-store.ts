import {
  WORKSPACE_SESSION_ARCHIVE_LIMIT,
  type WorkspaceSession,
  workspaceSessionActivitySchema,
  workspaceSessionSchema,
} from "@openducktor/contracts";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { HostResourceError, HostValidationError } from "../../effect/host-errors";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type {
  WorkspaceSessionStorePort,
  WorkspaceSessionStoreRef,
  WorkspaceSessionStoreScope,
} from "../../ports/workspace-session-store-port";
import type { SqliteTaskRepositoryContextProvider } from "./sqlite-task-repository-context";
import type { TaskStoreSession } from "./sqlite-task-store-schema";
import { type WorkspaceSessionRow, workspaceSessions } from "./sqlite-workspace-session-schema";

const validateRecord = (value: WorkspaceSession) =>
  Effect.try({
    try: () => workspaceSessionSchema.parse(value),
    catch: (cause) =>
      new HostValidationError({ message: "Invalid Workspace Session record.", cause }),
  });

const decodeRecord = (row: WorkspaceSessionRow) =>
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
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        archivedAt: row.archivedAt,
      }),
    catch: (cause) =>
      new HostValidationError({
        message: `Stored Workspace Session ${row.id} is invalid.`,
        cause,
      }),
  });

const encodeRecord = (record: WorkspaceSession): WorkspaceSessionRow => ({
  id: record.id,
  runtimeKind: record.runtimeKind,
  externalSessionId: record.externalSessionId,
  executionTargetJson: JSON.stringify(record.executionTarget),
  roleSnapshotJson: record.roleSnapshot === null ? null : JSON.stringify(record.roleSnapshot),
  selectedModelJson: record.selectedModel === null ? null : JSON.stringify(record.selectedModel),
  generatedTitle: record.generatedTitle,
  manualTitle: record.manualTitle,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  archivedAt: record.archivedAt,
});

const getRecord = (session: TaskStoreSession, sessionId: string) =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (database) =>
        database
          .select()
          .from(workspaceSessions)
          .where(eq(workspaceSessions.id, sessionId))
          .limit(1),
      "workspaceSessionStore.get",
    );
    const row = rows[0];
    if (!row)
      return yield* new HostResourceError({
        resource: sessionId,
        operation: "workspaceSessionStore.get",
        message: `Workspace Session ${sessionId} does not exist in this Workspace.`,
      });
    return yield* decodeRecord(row);
  });

export const createSqliteWorkspaceSessionStore = (
  contextProvider: SqliteTaskRepositoryContextProvider,
): WorkspaceSessionStorePort => {
  const withDatabase = <A>(
    scope: WorkspaceSessionStoreScope,
    operation: string,
    use: (session: TaskStoreSession) => Effect.Effect<A, TaskStoreError>,
  ) =>
    contextProvider(scope.repoPath, operation, (context) => {
      if (context.workspaceId !== scope.workspaceId)
        return Effect.fail(
          new HostValidationError({
            field: "workspaceId",
            message:
              "The Workspace no longer matches this Repository. Reload the Workspace before retrying.",
          }),
        );
      return use(context.session);
    });

  const update = (
    ref: WorkspaceSessionStoreRef,
    operation: string,
    change: (current: WorkspaceSession) => WorkspaceSession,
  ) =>
    withDatabase(ref, operation, (session) =>
      session.transaction(operation, (transaction) =>
        Effect.gen(function* () {
          const current = yield* getRecord(transaction, ref.sessionId);
          const next = yield* validateRecord(change(current));
          const row = encodeRecord(next);
          if (JSON.stringify(row) !== JSON.stringify(encodeRecord(current))) {
            yield* transaction.execute(
              (database) =>
                database
                  .update(workspaceSessions)
                  .set(row)
                  .where(eq(workspaceSessions.id, ref.sessionId)),
              operation,
            );
          }
          return next;
        }),
      ),
    );

  return {
    get: (input) =>
      withDatabase(input, "workspaceSessionStore.get", (session) =>
        getRecord(session, input.sessionId),
      ),
    listAll: (input) =>
      withDatabase(input, "workspaceSessionStore.listAll", (session) =>
        Effect.gen(function* () {
          const rows = yield* session.execute(
            (database) => database.select().from(workspaceSessions),
            "workspaceSessionStore.listAll",
          );
          return yield* Effect.forEach(rows, decodeRecord);
        }),
      ),
    listActive: (input) =>
      withDatabase(input, "workspaceSessionStore.listActive", (session) =>
        Effect.gen(function* () {
          const rows = yield* session.execute(
            (database) =>
              database
                .select()
                .from(workspaceSessions)
                .where(isNull(workspaceSessions.archivedAt))
                .orderBy(desc(workspaceSessions.updatedAt)),
            "workspaceSessionStore.listActive",
          );
          return yield* Effect.forEach(rows, decodeRecord);
        }),
      ),
    listArchived: (input) =>
      withDatabase(input, "workspaceSessionStore.listArchived", (session) =>
        Effect.gen(function* () {
          const rows = yield* session.execute(
            (database) =>
              database
                .select()
                .from(workspaceSessions)
                .where(isNotNull(workspaceSessions.archivedAt))
                .orderBy(desc(workspaceSessions.archivedAt))
                .limit(WORKSPACE_SESSION_ARCHIVE_LIMIT),
            "workspaceSessionStore.listArchived",
          );
          return yield* Effect.forEach(rows, decodeRecord);
        }),
      ),
    findByRuntimeSession: (input) =>
      withDatabase(input, "workspaceSessionStore.findByRuntimeSession", (session) =>
        Effect.gen(function* () {
          const rows = yield* session.execute(
            (database) =>
              database
                .select()
                .from(workspaceSessions)
                .where(
                  and(
                    eq(workspaceSessions.runtimeKind, input.runtimeKind),
                    eq(workspaceSessions.externalSessionId, input.externalSessionId),
                  ),
                )
                .limit(1),
            "workspaceSessionStore.findByRuntimeSession",
          );
          return rows[0] ? yield* decodeRecord(rows[0]) : null;
        }),
      ),
    create: (input) =>
      withDatabase(input, "workspaceSessionStore.create", (session) =>
        Effect.gen(function* () {
          const record = yield* validateRecord(input.session);
          yield* session.execute(
            (database) => database.insert(workspaceSessions).values(encodeRecord(record)),
            "workspaceSessionStore.create",
          );
          return record;
        }),
      ),
    bindRuntimeSession: (input) =>
      withDatabase(input, "workspaceSessionStore.bindRuntimeSession", (session) =>
        session.transaction("workspaceSessionStore.bindRuntimeSession", (transaction) =>
          Effect.gen(function* () {
            const current = yield* getRecord(transaction, input.sessionId);
            if (current.externalSessionId !== null || current.archivedAt !== null) {
              return yield* new HostValidationError({
                field: "sessionId",
                message: "Only an active draft can bind a runtime session.",
              });
            }
            const next = yield* validateRecord({
              ...current,
              externalSessionId: input.externalSessionId,
            });
            yield* transaction.execute(
              (database) =>
                database
                  .update(workspaceSessions)
                  .set(encodeRecord(next))
                  .where(eq(workspaceSessions.id, input.sessionId)),
              "workspaceSessionStore.bindRuntimeSession",
            );
            return next;
          }),
        ),
      ),
    rename: (input) =>
      update(input, "workspaceSessionStore.rename", (current) => {
        const title = input.manualTitle?.trim().replace(/\s+/g, " ");
        return { ...current, manualTitle: title || null };
      }),
    archive: (input) =>
      update(input, "workspaceSessionStore.archive", (current) => ({
        ...current,
        archivedAt: current.archivedAt ?? input.archivedAt,
        executionTarget: input.executionTarget ?? current.executionTarget,
      })),
    restore: (input) =>
      update(input, "workspaceSessionStore.restore", (current) => ({
        ...current,
        archivedAt: null,
        executionTarget: input.executionTarget ?? current.executionTarget,
      })),
    setSelectedModel: (input) =>
      update(input, "workspaceSessionStore.setSelectedModel", (current) => ({
        ...current,
        selectedModel: input.selectedModel,
      })),
    setGeneratedTitle: (input) =>
      update(input, "workspaceSessionStore.setGeneratedTitle", (current) => ({
        ...current,
        generatedTitle: input.generatedTitle,
      })),
    recordAcceptedMessage: (input) =>
      Effect.gen(function* () {
        const activity = yield* Effect.try({
          try: () =>
            workspaceSessionActivitySchema.parse({
              type: "user_message",
              occurredAt: input.occurredAt,
            }),
          catch: (cause) =>
            new HostValidationError({ message: "Invalid Workspace Session activity.", cause }),
        });
        return yield* update(input, "workspaceSessionStore.recordAcceptedMessage", (current) => ({
          ...current,
          generatedTitle: current.generatedTitle ?? input.generatedTitle,
          updatedAt: Math.max(current.updatedAt, activity.occurredAt),
          selectedModel: input.selectedModel ?? current.selectedModel,
        }));
      }),
    recordActivity: (input) =>
      Effect.gen(function* () {
        const activity = yield* Effect.try({
          try: () => workspaceSessionActivitySchema.parse(input.activity),
          catch: (cause) =>
            new HostValidationError({ message: "Invalid Workspace Session activity.", cause }),
        });
        return yield* update(input, "workspaceSessionStore.recordActivity", (current) => ({
          ...current,
          updatedAt: Math.max(current.updatedAt, activity.occurredAt),
        }));
      }),
  };
};
