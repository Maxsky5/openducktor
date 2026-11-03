import { eq, inArray } from "drizzle-orm";
import { Context, Deferred, Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { type WorkspaceAccess, workspaceAccessBlock } from "../../domain/workspace-access";
import {
  HostOperationError,
  HostValidationError,
  type HostOperationErrorAggregate,
} from "../../effect/host-errors";
import { resolveSqliteHostDatabasePath } from "../../infrastructure/sqlite/sqlite-host-database-path";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import type { WorkspaceSessionStoreScope } from "../../ports/workspace-session-store-port";
import { sqliteValues } from "./sqlite-parameters";
import {
  openHostDatabaseConnection,
  type OpenHostDatabaseConnection,
} from "./sqlite-host-database-connection";
import { createHostDatabaseConnectionSlot } from "./sqlite-host-database-connection-slot";
import { mapSqliteTaskStoreAdapterError } from "./sqlite-task-store-errors";
import type { HostDatabaseSession } from "./sqlite-host-database-schema";
import { workspaceRemovals, workspaces } from "./sqlite-host-settings-schema";

/** A workspace and the lifecycle access of one operation. Without access, the operation needs `open`. */
export type WorkspaceDatabaseScope = WorkspaceSessionStoreScope & {
  access?: WorkspaceAccess | undefined;
};
export type SqliteTaskRepositoryContext = {
  databasePath: string;
  repoPath: string;
  session: HostDatabaseSession;
  workspaceId: string;
  taskWorkflows: TaskWorkflowResolver;
};

/**
 * A read of many tasks hides a task in a state that ends a task in a host workflow. The resolver
 * checked that a shared state has one terminal meaning in every workflow.
 */
export const hostTerminalStates = (taskWorkflows: TaskWorkflowResolver): string[] => [
  ...new Set(taskWorkflows.workflows.flatMap(({ terminalStates }) => terminalStates)),
];

export type SqliteTaskRepositoryContextProvider = <A>(
  scope: WorkspaceDatabaseScope,
  operation: string,
  use: (context: SqliteTaskRepositoryContext) => Effect.Effect<A, unknown>,
) => Effect.Effect<A, TaskStoreError>;
type SqliteWorkspacesReadContext = {
  session: HostDatabaseSession;
  taskWorkflows: TaskWorkflowResolver;
};
/** Runs one read transaction over several workspaces. It checks every workspace in that transaction. */
export type SqliteWorkspacesReadProvider = <A>(
  scopes: readonly WorkspaceDatabaseScope[],
  operation: string,
  use: (context: SqliteWorkspacesReadContext) => Effect.Effect<A, unknown>,
) => Effect.Effect<A, TaskStoreError>;
/** Reads several workspaces with one access in one transaction. An empty set reads nothing. */
export const readWorkspaceSet = <A>(
  readWorkspaces: SqliteWorkspacesReadProvider,
  workspaces: readonly WorkspaceSessionStoreScope[],
  access: WorkspaceAccess,
  operation: string,
  use: (context: {
    session: HostDatabaseSession;
    workspaceIds: string[];
    terminalStates: string[];
  }) => Effect.Effect<A[], unknown>,
): Effect.Effect<A[], TaskStoreError> =>
  workspaces.length === 0
    ? Effect.succeed([])
    : readWorkspaces(
        workspaces.map((scope) => ({ ...scope, access })),
        operation,
        ({ session, taskWorkflows }) =>
          use({
            session,
            workspaceIds: workspaces.map(({ workspaceId }) => workspaceId),
            terminalStates: hostTerminalStates(taskWorkflows),
          }),
      );
export type SqliteHostDatabaseProvider = <A, E>(
  operation: string,
  use: (session: HostDatabaseSession) => Effect.Effect<A, E>,
) => Effect.Effect<A, E | TaskStoreError>;
export type SqliteHostDatabaseManager = {
  readonly dispose: () => Effect.Effect<
    void,
    HostOperationError<{ failures: HostOperationErrorAggregate[] }>
  >;
  readonly withDatabase: SqliteTaskRepositoryContextProvider;
  readonly readWorkspaces: SqliteWorkspacesReadProvider;
  readonly withHostDatabase: SqliteHostDatabaseProvider;
};
type CreateSqliteHostDatabaseManagerInput = {
  configDir: string;
  openConnection?: OpenHostDatabaseConnection;
  taskWorkflows: TaskWorkflowResolver;
};
type AdmissionGate = {
  readonly stop: () => Effect.Effect<void>;
  readonly withLease: <A, E>(
    use: () => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | HostOperationError>;
};

/**
 * Checks the current registration, repository path, and lifecycle state of each workspace with
 * one query. Run it in the transaction of the operation, because another host can close or
 * remove the workspace.
 */
const validateScopes = (session: HostDatabaseSession, scopes: readonly WorkspaceDatabaseScope[]) =>
  Effect.gen(function* () {
    if (scopes.length === 0) return;
    const rows = yield* session.execute(
      (db) =>
        db
          .select({
            workspaceId: workspaces.workspaceId,
            repoPath: workspaces.repoPath,
            closed: workspaces.closed,
            removal: workspaceRemovals.workspaceId,
          })
          .from(workspaces)
          .leftJoin(workspaceRemovals, eq(workspaceRemovals.workspaceId, workspaces.workspaceId))
          .where(
            inArray(
              workspaces.workspaceId,
              sqliteValues(scopes.map(({ workspaceId }) => workspaceId)),
            ),
          ),
      "sqliteTaskRepository.validateWorkspace",
    );
    const byId = new Map(rows.map((row) => [row.workspaceId, row]));
    for (const scope of scopes) {
      const row = byId.get(scope.workspaceId);
      if (
        !row ||
        normalizePathForComparison(row.repoPath) !== normalizePathForComparison(scope.repoPath)
      )
        return yield* new HostValidationError({
          field: "workspaceId",
          message:
            "The workspace no longer matches this repository. Reload the workspace before retrying.",
        });
      const blocked = workspaceAccessBlock(
        scope.workspaceId,
        { closed: row.closed, removal: row.removal !== null },
        scope.access ?? "open",
      );
      if (blocked !== null)
        return yield* new HostValidationError({ field: "workspaceId", message: blocked });
    }
  });

export const createSqliteHostDatabaseManager = ({
  configDir,
  openConnection = openHostDatabaseConnection,
  taskWorkflows,
}: CreateSqliteHostDatabaseManagerInput): SqliteHostDatabaseManager => {
  const admission = createAdmissionGate();
  const CurrentSession = Context.Reference<HostDatabaseSession | null>(
    `host-database-session:${crypto.randomUUID()}`,
    { defaultValue: () => null },
  );
  const databasePath = resolveSqliteHostDatabasePath(configDir);
  const slot = createHostDatabaseConnectionSlot({ databasePath, openConnection });
  const withHostDatabase: SqliteHostDatabaseProvider = (operation, use) =>
    Effect.gen(function* () {
      const current = yield* CurrentSession;
      if (current !== null) return yield* use(current);
      return yield* admission
        .withLease(() =>
          slot.run((session) => use(session).pipe(Effect.provideService(CurrentSession, session))),
        )
        .pipe(Effect.withSpan(operation));
    });
  /** Checks the scope again in each transaction, because another host can close the workspace. */
  const scopedSession = (
    session: HostDatabaseSession,
    scope: WorkspaceDatabaseScope,
  ): HostDatabaseSession => {
    const checked =
      (begin: HostDatabaseSession["transaction"]): HostDatabaseSession["transaction"] =>
      (name, use) =>
        begin(name, (transaction) =>
          validateScopes(transaction, [scope]).pipe(
            Effect.andThen(use(scopedSession(transaction, scope))),
            Effect.provideService(CurrentSession, transaction),
          ),
        );
    return {
      ...session,
      transaction: checked(session.transaction),
      readTransaction: checked(session.readTransaction),
    };
  };
  const withDatabase: SqliteTaskRepositoryContextProvider = (scope, operation, use) =>
    withHostDatabase(operation, (session) =>
      validateScopes(session, [scope]).pipe(
        Effect.andThen(
          use({
            workspaceId: scope.workspaceId,
            repoPath: scope.repoPath,
            databasePath,
            session: scopedSession(session, scope),
            taskWorkflows,
          }),
        ),
      ),
    ).pipe(
      Effect.mapError((cause) => mapSqliteTaskStoreAdapterError(operation, databasePath, cause)),
    );
  const readWorkspaces: SqliteWorkspacesReadProvider = (scopes, operation, use) =>
    withHostDatabase(operation, (session) =>
      session.readTransaction(operation, (transaction) =>
        validateScopes(transaction, scopes).pipe(
          Effect.andThen(use({ session: transaction, taskWorkflows })),
          Effect.provideService(CurrentSession, transaction),
        ),
      ),
    ).pipe(
      Effect.mapError((cause) => mapSqliteTaskStoreAdapterError(operation, databasePath, cause)),
    );
  const dispose = () =>
    Effect.gen(function* () {
      yield* admission.stop();
      const result = yield* Effect.result(slot.shutdown());
      if (result._tag === "Failure")
        return yield* new HostOperationError({
          operation: "sqliteTaskRepository.disposeConnections",
          message: result.failure.message,
          cause: result.failure,
          details: { failures: [result.failure] },
        });
    });
  return { withHostDatabase, withDatabase, readWorkspaces, dispose };
};

const hostIsStoppingError = () =>
  new HostOperationError({
    operation: "sqliteTaskRepository.acquireConnection",
    message: "The host database is stopping and cannot accept a new operation.",
  });

const invalidAdmissionReleaseError = () =>
  new HostOperationError({
    operation: "sqliteTaskRepository.releaseConnection",
    message: "The host database released an operation without an active admission lease.",
  });

const createAdmissionGate = (): AdmissionGate => {
  let accepting = true;
  let activeLeases = 0;
  let shutdownWaiter: Deferred.Deferred<void> | null = null;

  const acquireLease = Effect.suspend(() => {
    if (!accepting) {
      return Effect.fail(hostIsStoppingError());
    }
    activeLeases += 1;
    return Effect.void;
  });

  const releaseLease = Effect.suspend(() => {
    if (activeLeases === 0) {
      return Effect.die(invalidAdmissionReleaseError());
    }
    activeLeases -= 1;
    if (activeLeases > 0 || !shutdownWaiter) {
      return Effect.void;
    }
    return Deferred.succeed(shutdownWaiter, undefined).pipe(Effect.asVoid);
  });

  const withLease: AdmissionGate["withLease"] = (use) =>
    Effect.acquireUseRelease(acquireLease, use, () => releaseLease);

  const stop = () =>
    Effect.gen(function* () {
      const candidate = yield* Deferred.make<void>();
      const state = yield* Effect.sync(() => {
        accepting = false;
        shutdownWaiter ??= candidate;
        return { drained: activeLeases === 0, waiter: shutdownWaiter };
      });
      if (state.drained) {
        yield* Deferred.succeed(state.waiter, undefined);
      }
      yield* Deferred.await(state.waiter);
    });

  return { stop, withLease };
};
