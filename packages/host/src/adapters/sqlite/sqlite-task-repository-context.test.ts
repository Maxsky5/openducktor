import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { Deferred, Effect, Fiber, TestClock, TestContext } from "effect";
import { HostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
import { createSqliteTaskRepositoryContextManager } from "./sqlite-task-repository-context";
import { openSqliteTaskStoreConnection } from "./sqlite-task-store-connection";

const tempDirectories = new Set<string>();

const createHarness = async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), "odt-sqlite-context-"));
  tempDirectories.add(configDir);
  const manager = createSqliteTaskRepositoryContextManager({
    processEnv: {},
    resolveDatabasePath: ({ workspaceId }) =>
      Effect.succeed(path.join(configDir, workspaceId, "database.sqlite")),
    resolveWorkspaceIdForRepoPath: (repoPath) => Effect.succeed(path.basename(repoPath)),
  });
  return { configDir, manager };
};

const createCloseFailureHarness = async (
  onBackgroundFailure: (failure: HostOperationErrorAggregate) => Effect.Effect<void, never> = () =>
    Effect.void,
) => {
  const configDir = await mkdtemp(path.join(tmpdir(), "odt-sqlite-context-close-failure-"));
  tempDirectories.add(configDir);
  const manager = createSqliteTaskRepositoryContextManager({
    onBackgroundFailure,
    processEnv: {},
    resolveDatabasePath: ({ workspaceId }) =>
      Effect.succeed(path.join(configDir, workspaceId, "database.sqlite")),
    resolveWorkspaceIdForRepoPath: (repoPath) => Effect.succeed(path.basename(repoPath)),
    openConnection: (databasePath) =>
      openSqliteTaskStoreConnection(databasePath).pipe(
        Effect.map((connection) => ({
          ...connection,
          release: connection.release.pipe(
            Effect.zipRight(
              Effect.fail(
                new HostOperationError({
                  operation: "test.closeSqliteTaskStoreConnection",
                  message: `Failed to close ${path.basename(path.dirname(databasePath))}.`,
                }),
              ),
            ),
          ),
        })),
      ),
  });
  return manager;
};

afterEach(async () => {
  await Promise.all(
    Array.from(tempDirectories, (directory) => rm(directory, { force: true, recursive: true })),
  );
  tempDirectories.clear();
});

test("reuses one SQLite connection for repeated operations on the same database path", async () => {
  const { manager } = await createHarness();

  try {
    const [first, second] = await Effect.runPromise(
      Effect.all(
        [
          manager.withDatabase("/repos/alpha", "test.first", ({ session }) =>
            Effect.succeed(session.database),
          ),
          manager.withDatabase("/repos/alpha", "test.second", ({ session }) =>
            Effect.succeed(session.database),
          ),
        ],
        { concurrency: "unbounded" },
      ),
    );

    expect(second).toBe(first);
  } finally {
    await Effect.runPromise(manager.dispose());
  }
});

test("does not open configured workspace databases before their first operation", async () => {
  const { configDir, manager } = await createHarness();

  try {
    expect(await Bun.file(path.join(configDir, "alpha", "database.sqlite")).exists()).toBe(false);
  } finally {
    await Effect.runPromise(manager.dispose());
  }
});

test("opens a connection using only the resolved database path", async () => {
  const inputs: unknown[] = [];
  const manager = createSqliteTaskRepositoryContextManager({
    openConnection: (databasePath) => {
      inputs.push(databasePath);
      return Effect.fail(
        new HostOperationError({
          operation: "test.openSqliteTaskStoreConnection",
          message: "Stop after observing the connection input.",
        }),
      );
    },
    processEnv: {},
    resolveDatabasePath: () => Effect.succeed("/task-stores/alpha/database.sqlite"),
    resolveWorkspaceIdForRepoPath: () => Effect.succeed("alpha"),
  });

  await Effect.runPromise(
    Effect.either(
      manager.withDatabase("/repos/alpha", "test.observe-open-input", () => Effect.void),
    ),
  );

  expect(inputs).toEqual(["/task-stores/alpha/database.sqlite"]);
  await Effect.runPromise(manager.dispose());
});

test("closes an idle SQLite connection after five minutes", async () => {
  const { manager } = await createHarness();

  try {
    const [beforeExpiry, afterExpiry] = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* manager.withDatabase(
          "/repos/alpha",
          "test.before-expiry",
          ({ session }) => Effect.succeed(session.database),
        );
        yield* TestClock.adjust("5 minutes");
        yield* Effect.yieldNow();
        const second = yield* manager.withDatabase(
          "/repos/alpha",
          "test.after-expiry",
          ({ session }) => Effect.succeed(session.database),
        );
        return [first, second] as const;
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(afterExpiry).not.toBe(beforeExpiry);
  } finally {
    await Effect.runPromise(manager.dispose());
  }
});

test("restarts the idle timeout after later activity", async () => {
  const { manager } = await createHarness();

  try {
    const [first, beforeResetExpiry, afterResetExpiry] = await Effect.runPromise(
      Effect.gen(function* () {
        const initial = yield* manager.withDatabase("/repos/alpha", "test.initial", ({ session }) =>
          Effect.succeed(session.database),
        );
        yield* TestClock.adjust("4 minutes");
        const reused = yield* manager.withDatabase("/repos/alpha", "test.reuse", ({ session }) =>
          Effect.succeed(session.database),
        );
        yield* TestClock.adjust("4 minutes");
        const stillOpen = yield* manager.withDatabase(
          "/repos/alpha",
          "test.before-reset-expiry",
          ({ session }) => Effect.succeed(session.database),
        );
        yield* TestClock.adjust("5 minutes");
        yield* Effect.yieldNow();
        const reopened = yield* manager.withDatabase(
          "/repos/alpha",
          "test.after-reset-expiry",
          ({ session }) => Effect.succeed(session.database),
        );
        expect(reused).toBe(initial);
        return [initial, stillOpen, reopened] as const;
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(beforeResetExpiry).toBe(first);
    expect(afterResetExpiry).not.toBe(first);
  } finally {
    await Effect.runPromise(manager.dispose());
  }
});

test("keeps every recently active database path open without a global connection limit", async () => {
  const { manager } = await createHarness();

  try {
    const sessions = await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: 6 }, (_, index) => `/repos/workspace-${index}`),
        (repoPath) =>
          manager.withDatabase(repoPath, "test.open-workspace", ({ session }) =>
            Effect.succeed(session),
          ),
      ),
    );

    await Effect.runPromise(
      Effect.forEach(
        sessions,
        (session) =>
          session
            .execute(
              (database) => database.run(sql.raw("SELECT 1;")),
              "test.verify-open-connection",
            )
            .pipe(Effect.asVoid),
        { discard: true },
      ),
    );
    expect(sessions).toHaveLength(6);
  } finally {
    await Effect.runPromise(manager.dispose());
  }
});

test("serializes complete operations that use the same database path", async () => {
  const { manager } = await createHarness();

  try {
    const { afterRelease, beforeRelease } = await Effect.runPromise(
      Effect.gen(function* () {
        const events: string[] = [];
        const firstEntered = yield* Deferred.make<void>();
        const releaseFirst = yield* Deferred.make<void>();
        const secondAttempted = yield* Deferred.make<void>();
        const first = yield* Effect.fork(
          manager.withDatabase("/repos/alpha", "test.first-operation", () =>
            Effect.gen(function* () {
              events.push("first:start");
              yield* Deferred.succeed(firstEntered, undefined);
              yield* Deferred.await(releaseFirst);
              events.push("first:end");
            }),
          ),
        );
        yield* Deferred.await(firstEntered);
        const second = yield* Effect.fork(
          Effect.gen(function* () {
            yield* Deferred.succeed(secondAttempted, undefined);
            yield* manager.withDatabase("/repos/alpha", "test.second-operation", () =>
              Effect.sync(() => events.push("second")),
            );
          }),
        );
        yield* Deferred.await(secondAttempted);
        yield* Effect.yieldNow();
        const beforeRelease = [...events];
        yield* Deferred.succeed(releaseFirst, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);
        return { afterRelease: [...events], beforeRelease };
      }),
    );

    expect(beforeRelease).toEqual(["first:start"]);
    expect(afterRelease).toEqual(["first:start", "first:end", "second"]);
  } finally {
    await Effect.runPromise(manager.dispose());
  }
});

test("stops admission and drains an active operation before disposal completes", async () => {
  const { manager } = await createHarness();

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const events: string[] = [];
      const operationEntered = yield* Deferred.make<void>();
      const releaseOperation = yield* Deferred.make<void>();
      const operation = yield* Effect.fork(
        manager.withDatabase("/repos/alpha", "test.active-operation", () =>
          Effect.gen(function* () {
            events.push("operation:start");
            yield* Deferred.succeed(operationEntered, undefined);
            yield* Deferred.await(releaseOperation);
            events.push("operation:end");
          }),
        ),
      );
      yield* Deferred.await(operationEntered);
      const disposal = yield* Effect.fork(
        manager.dispose().pipe(Effect.tap(() => Effect.sync(() => events.push("disposed")))),
      );
      yield* Effect.yieldNow();
      const beforeRelease = [...events];
      yield* Deferred.succeed(releaseOperation, undefined);
      yield* Fiber.join(operation);
      yield* Fiber.join(disposal);
      const admissionResult = yield* Effect.either(
        manager.withDatabase("/repos/alpha", "test.after-dispose", () => Effect.void),
      );
      return { admissionResult, afterRelease: [...events], beforeRelease };
    }),
  );

  expect(result.beforeRelease).toEqual(["operation:start"]);
  expect(result.afterRelease).toEqual(["operation:start", "operation:end", "disposed"]);
  expect(result.admissionResult._tag).toBe("Left");
  if (result.admissionResult._tag === "Left") {
    expect(result.admissionResult.left).toMatchObject({
      _tag: "HostOperationError",
      operation: "sqliteTaskRepository.acquireConnection",
    });
  }
});

test("closes retained connections during disposal", async () => {
  const { manager } = await createHarness();
  const session = await Effect.runPromise(
    manager.withDatabase("/repos/alpha", "test.capture-session", ({ session }) =>
      Effect.succeed(session),
    ),
  );

  await Effect.runPromise(manager.dispose());

  const queryResult = await Effect.runPromise(
    Effect.either(
      session.execute((database) => database.run(sql.raw("SELECT 1;")), "test.query-after-dispose"),
    ),
  );
  expect(queryResult._tag).toBe("Left");
});

test("reports close failures from every retained database during disposal", async () => {
  const manager = await createCloseFailureHarness();
  await Effect.runPromise(
    Effect.forEach(
      ["/repos/alpha", "/repos/beta"],
      (repoPath) => manager.withDatabase(repoPath, "test.open", () => Effect.void),
      { discard: true },
    ),
  );

  const result = await Effect.runPromise(Effect.either(manager.dispose()));

  expect(result._tag).toBe("Left");
  if (result._tag === "Left") {
    expect(result.left.message.split("\n").sort()).toEqual([
      "Failed to close alpha.",
      "Failed to close beta.",
    ]);
  }
});

test("reports an idle close failure and rejects later operations for that database", async () => {
  const backgroundFailures: HostOperationErrorAggregate[] = [];
  const manager = await createCloseFailureHarness((failure) =>
    Effect.sync(() => {
      backgroundFailures.push(failure);
    }),
  );

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      yield* manager.withDatabase("/repos/alpha", "test.open", () => Effect.void);
      yield* TestClock.adjust("5 minutes");
      yield* Effect.yieldNow();
      return yield* Effect.either(
        manager.withDatabase("/repos/alpha", "test.after-close-failure", () => Effect.void),
      );
    }).pipe(Effect.provide(TestContext.TestContext)),
  );

  expect(backgroundFailures.map((failure) => failure.message)).toEqual(["Failed to close alpha."]);
  expect(result._tag).toBe("Left");
  if (result._tag === "Left") {
    expect(result.left.message).toBe("Failed to close alpha.");
  }
  await Effect.runPromise(manager.dispose().pipe(Effect.ignore));
});
