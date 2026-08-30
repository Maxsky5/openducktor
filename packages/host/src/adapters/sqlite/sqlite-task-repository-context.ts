import { Deferred, Effect } from "effect";
import { resolveOpenDucktorBaseDir } from "../../config/openducktor-config-dir";
import { HostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
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
  readonly dispose: () => Effect.Effect<
    void,
    HostOperationError<{ failures: HostOperationErrorAggregate[] }>
  >;
  readonly withDatabase: SqliteTaskRepositoryContextProvider;
};

type CreateSqliteTaskRepositoryContextManagerInput = {
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
  onBackgroundFailure = (failure) => Effect.logError(failure.message),
  openConnection = openSqliteTaskStoreConnection,
  processEnv,
  resolveDatabasePath = resolveDefaultDatabasePath(processEnv),
  resolveWorkspaceIdForRepoPath,
}: CreateSqliteTaskRepositoryContextManagerInput): SqliteTaskRepositoryContextManager => {
  const admission = createAdmissionGate();
  const slots = new Map<string, SqliteTaskStoreConnectionSlot>();

  const resolveStorage = (repoPath: string) =>
    Effect.gen(function* () {
      const workspaceId = yield* resolveWorkspaceIdForRepoPath(repoPath);
      const databasePath = yield* resolveDatabasePath({ repoPath, workspaceId });
      return { databasePath, repoPath, workspaceId };
    });

  const getSlot = (databasePath: string) => {
    const current = slots.get(databasePath);
    if (current) return current;
    const slot = createSqliteTaskStoreConnectionSlot({
      databasePath,
      onBackgroundFailure,
      openConnection,
    });
    slots.set(databasePath, slot);
    return slot;
  };

  const withDatabase: SqliteTaskRepositoryContextProvider = (repoPath, operation, use) =>
    admission.withLease(() =>
      Effect.gen(function* () {
        const storage = yield* resolveStorage(repoPath);
        const slot = getSlot(storage.databasePath);
        return yield* slot
          .run((session) => use({ ...storage, session }))
          .pipe(
            Effect.mapError((cause) =>
              mapSqliteTaskStoreAdapterError(operation, storage.databasePath, cause),
            ),
          );
      }),
    );

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

  return { dispose, withDatabase };
};
