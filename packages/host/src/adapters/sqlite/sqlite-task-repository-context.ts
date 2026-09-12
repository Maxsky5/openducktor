import { Deferred, Effect } from "effect";
import { resolveOpenDucktorBaseDir } from "../../config/openducktor-config-dir";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import { resolveSqliteTaskStoreDatabasePath } from "../../infrastructure/sqlite/sqlite-task-store-path";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import {
  type OpenSqliteTaskStoreConnection,
  openSqliteTaskStoreConnection,
} from "./sqlite-task-store-connection";
import {
  createSqliteTaskStoreConnectionSlot,
  type SqliteTaskStoreConnectionSlot,
} from "./sqlite-task-store-connection-slot";
import { mapSqliteTaskStoreAdapterError } from "./sqlite-task-store-errors";
import type { TaskStoreSession } from "./sqlite-task-store-schema";

export type ResolveWorkspaceIdForRepoPath = (
  repoPath: string,
) => Effect.Effect<string, TaskStoreError>;

export type ResolveSqliteTaskStorePath = (input: {
  repoPath: string;
  workspaceId: string;
}) => Effect.Effect<string, TaskStoreError>;

export type SqliteTaskRepositoryContext = {
  databasePath: string;
  repoPath: string;
  session: TaskStoreSession;
  workspaceId: string;
};

export type SqliteTaskRepositoryContextProvider = <A>(
  repoPath: string,
  operation: string,
  use: (context: SqliteTaskRepositoryContext) => Effect.Effect<A, unknown>,
) => Effect.Effect<A, TaskStoreError>;

export type SqliteTaskRepositoryContextManager = {
  readonly closeWorkspace: (
    workspaceId: string,
  ) => Effect.Effect<void, HostOperationError<{ workspaceId: string }>>;
  readonly dispose: () => Effect.Effect<
    void,
    HostOperationError<{ failures: HostOperationErrorAggregate[] }>
  >;
  readonly withDatabase: SqliteTaskRepositoryContextProvider;
};

type CreateSqliteTaskRepositoryContextManagerInput = {
  assertWorkspaceAdmitted?: (input: {
    operation: string;
    repoPath: string;
    workspaceId: string;
  }) => Effect.Effect<void, HostOperationErrorAggregate | HostValidationErrorAggregate>;
  onBackgroundFailure?: (failure: HostOperationErrorAggregate) => Effect.Effect<void, never>;
  openConnection?: OpenSqliteTaskStoreConnection;
  processEnv: NodeJS.ProcessEnv;
  resolveDatabasePath?: ResolveSqliteTaskStorePath;
  resolveWorkspaceIdForRepoPath: ResolveWorkspaceIdForRepoPath;
};

type AdmissionGate = {
  readonly stop: () => Effect.Effect<void>;
  readonly withLease: <A, E>(
    use: () => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | HostOperationError>;
};

const resolveDefaultDatabasePath =
  (processEnv: NodeJS.ProcessEnv): ResolveSqliteTaskStorePath =>
  ({ workspaceId }) =>
    resolveSqliteTaskStoreDatabasePath({
      configDir: resolveOpenDucktorBaseDir(processEnv),
      workspaceId,
    });

const hostIsStoppingError = () =>
  new HostOperationError({
    operation: "sqliteTaskRepository.acquireConnection",
    message: "The SQLite task store is stopping and cannot accept a new operation.",
  });

const invalidAdmissionReleaseError = () =>
  new HostOperationError({
    operation: "sqliteTaskRepository.releaseConnection",
    message: "The SQLite task store released an operation without an active admission lease.",
  });

const workspaceClosingError = (workspaceId: string) =>
  new HostValidationError({
    field: "workspaceId",
    message: `The task store for workspace ${workspaceId} is closing. Retry after the lifecycle operation finishes.`,
  });

type WorkspaceLeaseState = {
  activeLeases: number;
  closing: boolean;
  drained: Deferred.Deferred<void> | null;
};

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

export const createSqliteTaskRepositoryContextManager = ({
  assertWorkspaceAdmitted,
  onBackgroundFailure = (failure) => Effect.logError(failure.message),
  openConnection = openSqliteTaskStoreConnection,
  processEnv,
  resolveDatabasePath = resolveDefaultDatabasePath(processEnv),
  resolveWorkspaceIdForRepoPath,
}: CreateSqliteTaskRepositoryContextManagerInput): SqliteTaskRepositoryContextManager => {
  const admission = createAdmissionGate();
  const slots = new Map<string, SqliteTaskStoreConnectionSlot>();
  const workspaceLeases = new Map<string, WorkspaceLeaseState>();

  const getWorkspaceLeaseState = (workspaceId: string): WorkspaceLeaseState => {
    const current = workspaceLeases.get(workspaceId);
    if (current) return current;
    const state: WorkspaceLeaseState = { activeLeases: 0, closing: false, drained: null };
    workspaceLeases.set(workspaceId, state);
    return state;
  };

  const acquireWorkspaceLease = (workspaceId: string) =>
    Effect.suspend(() => {
      const state = getWorkspaceLeaseState(workspaceId);
      if (state.closing) {
        return Effect.fail(workspaceClosingError(workspaceId));
      }
      state.activeLeases += 1;
      return Effect.void;
    });

  const releaseWorkspaceLease = (workspaceId: string) =>
    Effect.suspend(() => {
      const state = workspaceLeases.get(workspaceId);
      if (!state || state.activeLeases === 0) {
        return Effect.die(invalidAdmissionReleaseError());
      }
      state.activeLeases -= 1;
      if (state.activeLeases > 0 || !state.drained) {
        return Effect.void;
      }
      return Deferred.succeed(state.drained, undefined).pipe(Effect.asVoid);
    });

  const resolveStorage = (repoPath: string) =>
    Effect.gen(function* () {
      const workspaceId = yield* resolveWorkspaceIdForRepoPath(repoPath);
      const databasePath = yield* resolveDatabasePath({ repoPath, workspaceId });
      return { databasePath, repoPath, workspaceId };
    });

  const getSlot = (workspaceId: string, databasePath: string) => {
    const current = slots.get(workspaceId);
    if (current) return current;
    const slot = createSqliteTaskStoreConnectionSlot({
      databasePath,
      onBackgroundFailure,
      openConnection,
    });
    slots.set(workspaceId, slot);
    return slot;
  };

  const withDatabase: SqliteTaskRepositoryContextProvider = (repoPath, operation, use) =>
    admission.withLease(() =>
      Effect.gen(function* () {
        const storage = yield* resolveStorage(repoPath);
        return yield* Effect.acquireUseRelease(
          acquireWorkspaceLease(storage.workspaceId),
          () =>
            Effect.gen(function* () {
              if (assertWorkspaceAdmitted) {
                yield* assertWorkspaceAdmitted({
                  operation,
                  repoPath: storage.repoPath,
                  workspaceId: storage.workspaceId,
                });
              }
              const slot = getSlot(storage.workspaceId, storage.databasePath);
              return yield* slot
                .run((session) => use({ ...storage, session }))
                .pipe(
                  Effect.mapError((cause) =>
                    mapSqliteTaskStoreAdapterError(operation, storage.databasePath, cause),
                  ),
                );
            }),
          () => releaseWorkspaceLease(storage.workspaceId),
        );
      }),
    );

  const closeWorkspace = (workspaceId: string) =>
    Effect.gen(function* () {
      const state = getWorkspaceLeaseState(workspaceId);
      state.closing = true;
      if (state.activeLeases > 0) {
        const waiter = state.drained ?? (yield* Deferred.make<void>());
        state.drained = waiter;
        yield* Deferred.await(waiter);
      }
      const slot = slots.get(workspaceId);
      if (!slot) {
        workspaceLeases.delete(workspaceId);
        return;
      }
      const result = yield* Effect.either(slot.shutdown());
      if (result._tag === "Left") {
        return yield* new HostOperationError({
          operation: "sqliteTaskRepository.closeWorkspace",
          message: `Failed to close the task store for workspace ${workspaceId}: ${result.left.message}`,
          cause: result.left,
          details: { workspaceId },
        });
      }
      slots.delete(workspaceId);
      workspaceLeases.delete(workspaceId);
    });

  const dispose = () =>
    Effect.gen(function* () {
      yield* admission.stop();
      const results = yield* Effect.forEach(
        Array.from(slots.values()),
        (slot) => Effect.either(slot.shutdown()),
        { concurrency: "unbounded" },
      );
      const failures = results.flatMap((result) => (result._tag === "Left" ? [result.left] : []));
      if (failures.length > 0) {
        return yield* new HostOperationError({
          operation: "sqliteTaskRepository.disposeConnections",
          message: failures.map((failure) => failure.message).join("\n"),
          cause: failures[0],
          details: { failures },
        });
      }
    });

  return { closeWorkspace, dispose, withDatabase };
};
