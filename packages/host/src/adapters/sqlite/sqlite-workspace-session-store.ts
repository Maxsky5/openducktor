import { listRuntimeSessionOwners } from "./sqlite-runtime-session-owners";
import {
  WORKSPACE_SESSION_ARCHIVE_LIMIT,
  type WorkspaceSession,
  workspaceSessionActivitySchema,
  workspaceSessionSchema,
  workspaceSessionRenameInputSchema,
} from "@openducktor/contracts";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { Effect } from "effect";
import { HostResourceError, HostValidationError } from "../../effect/host-errors";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type {
  RuntimeSessionMatch,
  WorkspaceSessionStorePort,
  WorkspaceSessionStoreRef,
  WorkspaceSessionStoreScope,
  RuntimeOwnershipScope,
} from "../../ports/workspace-session-store-port";
import {
  readWorkspaceSet,
  type SqliteTaskRepositoryContext,
  type SqliteTaskRepositoryContextProvider,
  type SqliteWorkspacesReadProvider,
} from "./sqlite-task-repository-context";
import { sqliteValues } from "./sqlite-parameters";
import {
  readLiveSessionRoots,
  readWorktreeOwnershipChats,
} from "./sqlite-workspace-ownership-reads";
import type { HostDatabaseSession } from "./sqlite-host-database-schema";
import { workspaceSessions } from "./sqlite-workspace-session-schema";
import {
  decodeRecord,
  readActiveWorkspaceSessions,
  encodeWorkspaceSessionRecord,
  workspaceSessionScope,
} from "./sqlite-workspace-session-reads";
import { assertRuntimeOwnershipScope } from "./sqlite-runtime-ownership-scope";

const validateRecord = (value: WorkspaceSession) =>
  Effect.try({
    try: () => workspaceSessionSchema.parse(value),
    catch: (cause) =>
      new HostValidationError({ message: "Invalid Workspace Session record.", cause }),
  });

const getRecord = (session: HostDatabaseSession, workspaceId: string, sessionId: string) =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (database) =>
        database
          .select()
          .from(workspaceSessions)
          .where(workspaceSessionScope(workspaceId, sessionId))
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

const claimScope = (
  session: HostDatabaseSession,
  target: WorkspaceSessionStoreScope,
  scope: RuntimeOwnershipScope | undefined,
) =>
  scope === undefined
    ? Effect.fail(
        new HostValidationError({
          field: "ownershipScope",
          message:
            "Check the current workspace session ownership scope before saving a native conversation.",
        }),
      )
    : assertRuntimeOwnershipScope(session, scope, target);

export const createSqliteWorkspaceSessionStore = ({
  contextProvider,
  workspacesProvider,
}: {
  contextProvider: SqliteTaskRepositoryContextProvider;
  workspacesProvider: SqliteWorkspacesReadProvider;
}): WorkspaceSessionStorePort => {
  const withDatabase = <A>(
    scope: WorkspaceSessionStoreScope,
    operation: string,
    use: (
      session: HostDatabaseSession,
      context: SqliteTaskRepositoryContext,
    ) => Effect.Effect<A, TaskStoreError>,
  ) =>
    contextProvider(scope, operation, (context) => {
      if (context.workspaceId !== scope.workspaceId)
        return Effect.fail(
          new HostValidationError({
            field: "workspaceId",
            message:
              "The Workspace no longer matches this Repository. Reload the Workspace before retrying.",
          }),
        );
      return use(context.session, context);
    });

  const update = (
    ref: WorkspaceSessionStoreRef,
    operation: string,
    change: (current: WorkspaceSession) => WorkspaceSession,
  ) =>
    withDatabase(ref, operation, (_session, context) =>
      context.session.transaction(operation, (transaction) =>
        Effect.gen(function* () {
          const current = yield* getRecord(transaction, ref.workspaceId, ref.sessionId);
          const changed = yield* Effect.try({
            try: () => change(current),
            catch: (cause) =>
              new HostValidationError({ message: "Invalid Workspace Session update.", cause }),
          });
          const next = yield* validateRecord(changed);
          const row = encodeWorkspaceSessionRecord(ref.workspaceId, next);
          const didChange =
            JSON.stringify(row) !==
            JSON.stringify(encodeWorkspaceSessionRecord(ref.workspaceId, current));
          if (didChange) {
            yield* transaction.execute(
              (database) =>
                database
                  .update(workspaceSessions)
                  .set(row)
                  .where(workspaceSessionScope(ref.workspaceId, ref.sessionId)),
              operation,
            );
          }
          return next;
        }),
      ),
    );

  return {
    listForWorktreeOwnership: ({ workspaces }) =>
      readWorkspaceSet(
        workspacesProvider,
        workspaces,
        "ownership",
        "workspaceSessionStore.worktreeOwners",
        ({ session, workspaceIds }) => readWorktreeOwnershipChats(session, workspaceIds),
      ),
    listLiveSessionRoots: ({ workspaces }) =>
      readWorkspaceSet(
        workspacesProvider,
        workspaces,
        "open",
        "workspaceSessionStore.liveRoots",
        ({ session, workspaceIds, terminalStates }) =>
          readLiveSessionRoots(session, workspaceIds, terminalStates),
      ),
    listRuntimeOwners: ({ ownershipScope, filter, ...scope }) =>
      readWorkspaceSet(
        workspacesProvider,
        [scope],
        "ownership",
        "workspaceSessionStore.owners",
        ({ session }) =>
          Effect.gen(function* () {
            const ids =
              ownershipScope === undefined
                ? [scope.workspaceId]
                : yield* assertRuntimeOwnershipScope(session, ownershipScope, scope);
            return yield* listRuntimeSessionOwners(session, ids, filter).pipe(
              Effect.mapError(
                (cause) => new HostValidationError({ message: cause.message, cause }),
              ),
            );
          }),
      ),
    importSession: (input) =>
      withDatabase(input, "workspaceSessionStore.import", (_session, context) =>
        context.session.transaction<
          { session: WorkspaceSession; created: boolean },
          TaskStoreError
        >("workspaceSessionStore.import", (transaction) =>
          Effect.gen(function* () {
            const record = yield* validateRecord(input.session);
            if (record.externalSessionId === null)
              return yield* new HostValidationError({
                field: "externalSessionId",
                message: "An imported session requires a native conversation ID.",
              });
            const workspaceIds = yield* claimScope(transaction, input, input.ownershipScope);
            const owners = yield* listRuntimeSessionOwners(transaction, workspaceIds, {
              runtimeKind: record.runtimeKind,
              externalSessionIds: [record.externalSessionId],
            }).pipe(
              Effect.mapError(
                (cause) => new HostValidationError({ message: cause.message, cause }),
              ),
            );
            const owner = owners.find(
              (owner) =>
                owner.runtimeKind === record.runtimeKind &&
                owner.externalSessionId === record.externalSessionId,
            );
            if (owner) {
              if (owner.workspaceId !== input.workspaceId)
                return yield* new HostValidationError({
                  field: "externalSessionId",
                  message: `This conversation belongs to workspace ${owner.workspaceId}. Open it from that workspace.`,
                });
              if (owner.kind === "workspace" && !owner.archived)
                return {
                  session: yield* getRecord(transaction, input.workspaceId, owner.sessionId),
                  created: false,
                };
              return yield* new HostValidationError({
                field: "externalSessionId",
                message:
                  owner.kind === "task"
                    ? `This conversation belongs to task ${owner.taskId} (${owner.role}). Open it from that task.`
                    : "This conversation belongs to an archived chat. Restore it from archived sessions.",
              });
            }
            yield* transaction.execute(
              (db) =>
                db
                  .insert(workspaceSessions)
                  .values(encodeWorkspaceSessionRecord(input.workspaceId, record)),
              "workspaceSessionStore.import",
            );
            return { session: record, created: true };
          }),
        ),
      ),
    get: (input) =>
      withDatabase(input, "workspaceSessionStore.get", (session) =>
        getRecord(session, input.workspaceId, input.sessionId),
      ),
    listIds: (input) =>
      withDatabase(input, "workspaceSessionStore.listIds", (session) =>
        session
          .execute(
            (database) =>
              database
                .select({ id: workspaceSessions.id })
                .from(workspaceSessions)
                .where(workspaceSessionScope(input.workspaceId)),
            "workspaceSessionStore.listIds",
          )
          .pipe(Effect.map((rows) => rows.map(({ id }) => id))),
      ),
    listActive: (input) =>
      withDatabase(input, "workspaceSessionStore.listActive", (session) =>
        readActiveWorkspaceSessions(session, input.workspaceId),
      ),
    listArchived: (input) =>
      withDatabase(input, "workspaceSessionStore.listArchived", (session) =>
        Effect.gen(function* () {
          const rows = yield* session.execute(
            (database) =>
              database
                .select()
                .from(workspaceSessions)
                .where(
                  and(
                    workspaceSessionScope(input.workspaceId),
                    isNotNull(workspaceSessions.archivedAt),
                  ),
                )
                .orderBy(desc(workspaceSessions.archivedAt))
                .limit(WORKSPACE_SESSION_ARCHIVE_LIMIT),
            "workspaceSessionStore.listArchived",
          );
          return yield* Effect.forEach(rows, decodeRecord);
        }),
      ),
    findByRuntimeSession: ({ workspaces, runtimeKind, externalSessionId }) =>
      readWorkspaceSet(
        workspacesProvider,
        workspaces,
        "open",
        "workspaceSessionStore.findByRuntimeSession",
        ({ session, workspaceIds }) =>
          Effect.gen(function* () {
            const rows = yield* session.execute(
              (database) =>
                database
                  .select()
                  .from(workspaceSessions)
                  .where(
                    and(
                      inArray(workspaceSessions.workspaceId, sqliteValues(workspaceIds)),
                      eq(workspaceSessions.runtimeKind, runtimeKind),
                      eq(workspaceSessions.externalSessionId, externalSessionId),
                    ),
                  ),
              "workspaceSessionStore.findByRuntimeSession",
            );
            const matches: RuntimeSessionMatch[] = [];
            for (const scope of workspaces) {
              const row = rows.find((candidate) => candidate.workspaceId === scope.workspaceId);
              if (row) matches.push({ ...scope, session: yield* decodeRecord(row) });
            }
            return matches;
          }),
      ),
    create: (input) =>
      withDatabase(input, "workspaceSessionStore.create", (_session, context) =>
        context.session.transaction("workspaceSessionStore.create", (transaction) =>
          Effect.gen(function* () {
            const record = yield* validateRecord(input.session);
            if (record.externalSessionId !== null) {
              const workspaceIds = yield* claimScope(transaction, input, input.ownershipScope);
              const owners = yield* listRuntimeSessionOwners(transaction, workspaceIds, {
                runtimeKind: record.runtimeKind,
                externalSessionIds: [record.externalSessionId],
              }).pipe(
                Effect.mapError(
                  (cause) => new HostValidationError({ message: cause.message, cause }),
                ),
              );
              if (
                owners.some(
                  (owner) =>
                    owner.runtimeKind === record.runtimeKind &&
                    owner.externalSessionId === record.externalSessionId,
                )
              )
                return yield* new HostValidationError({
                  field: "externalSessionId",
                  message: "This runtime conversation already belongs to a chat or task.",
                });
            }
            yield* transaction.execute(
              (database) =>
                database
                  .insert(workspaceSessions)
                  .values(encodeWorkspaceSessionRecord(input.workspaceId, record)),
              "workspaceSessionStore.create",
            );
            return record;
          }),
        ),
      ),
    bindRuntimeSession: (input) =>
      withDatabase(input, "workspaceSessionStore.bindRuntimeSession", (_session, context) =>
        context.session.transaction("workspaceSessionStore.bindRuntimeSession", (transaction) =>
          Effect.gen(function* () {
            const current = yield* getRecord(transaction, input.workspaceId, input.sessionId);
            if (current.externalSessionId === input.externalSessionId) return current;
            if (current.externalSessionId !== null || current.archivedAt !== null) {
              return yield* new HostValidationError({
                field: "sessionId",
                message: "Only an active draft can bind a runtime session.",
              });
            }
            const workspaceIds = yield* claimScope(transaction, input, input.ownershipScope);
            const owner = (yield* listRuntimeSessionOwners(transaction, workspaceIds, {
              runtimeKind: current.runtimeKind,
              externalSessionIds: [input.externalSessionId],
            }).pipe(
              Effect.mapError(
                (cause) => new HostValidationError({ message: cause.message, cause }),
              ),
            )).find(
              (owner) =>
                owner.runtimeKind === current.runtimeKind &&
                owner.externalSessionId === input.externalSessionId,
            );
            if (owner)
              return yield* new HostValidationError({
                field: "externalSessionId",
                message: "This runtime conversation already belongs to another chat or task.",
              });
            const next = yield* validateRecord({
              ...current,
              externalSessionId: input.externalSessionId,
            });
            yield* transaction.execute(
              (database) =>
                database
                  .update(workspaceSessions)
                  .set(encodeWorkspaceSessionRecord(input.workspaceId, next))
                  .where(workspaceSessionScope(input.workspaceId, input.sessionId)),
              "workspaceSessionStore.bindRuntimeSession",
            );
            return next;
          }),
        ),
      ),
    setExecutionTarget: (input) =>
      update(input, "workspaceSessionStore.setExecutionTarget", (current) => ({
        ...current,
        executionTarget: input.executionTarget,
      })),
    rename: (input) =>
      update(input, "workspaceSessionStore.rename", (current) => {
        const title = workspaceSessionRenameInputSchema.shape.manualTitle.parse(input.manualTitle);
        return { ...current, manualTitle: title || null };
      }),
    setPersistedTitle: (input) =>
      update(input, "workspaceSessionStore.setPersistedTitle", (current) => ({
        ...current,
        manualTitle: workspaceSessionSchema.shape.manualTitle.parse(input.manualTitle),
      })),
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
    setTargetBranch: (input) =>
      update(input, "workspaceSessionStore.setTargetBranch", (current) => ({
        ...current,
        targetBranch: input.targetBranch,
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
          lastActivityAt: Math.max(
            current.lastActivityAt ?? current.createdAt,
            activity.occurredAt,
          ),
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
          lastActivityAt: Math.max(
            current.lastActivityAt ?? current.createdAt,
            activity.occurredAt,
          ),
        }));
      }),
  };
};
