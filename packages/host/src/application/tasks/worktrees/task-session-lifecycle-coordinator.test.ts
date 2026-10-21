import { expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import { createTaskSessionLifecycleCoordinator } from "./task-session-lifecycle-coordinator";

test("worktree reads overlap while lifecycle waits for every reader and then blocks new reads", async () => {
  const coordinator = createTaskSessionLifecycleCoordinator();
  const events: string[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const catalogStarted = yield* Deferred.make<void>();
      const historyStarted = yield* Deferred.make<void>();
      const finishCatalog = yield* Deferred.make<void>();
      const finishHistory = yield* Deferred.make<void>();
      const lifecycleStarted = yield* Deferred.make<void>();
      const finishLifecycle = yield* Deferred.make<void>();
      const laterReadStarted = yield* Deferred.make<void>();
      const catalog = yield* Effect.forkChild(
        coordinator.runWorktreeRead(
          "/repo/task-1",
          Effect.gen(function* () {
            events.push("catalog-start");
            yield* Deferred.succeed(catalogStarted, undefined);
            yield* Deferred.await(finishCatalog);
            events.push("catalog-end");
          }),
        ),
      );
      yield* Deferred.await(catalogStarted);
      const history = yield* Effect.forkChild(
        coordinator.runWorktreeRead(
          "/repo/task-1",
          Effect.gen(function* () {
            events.push("history-start");
            yield* Deferred.succeed(historyStarted, undefined);
            yield* Deferred.await(finishHistory);
            events.push("history-end");
          }),
        ),
      );
      yield* Deferred.await(historyStarted).pipe(Effect.timeout("1 second"));
      const lifecycle = yield* Effect.forkChild(
        Effect.scoped(
          Effect.gen(function* () {
            yield* coordinator.acquireWorktreeLifecycle(["/repo/task-1"]);
            events.push("lifecycle-start");
            yield* Deferred.succeed(lifecycleStarted, undefined);
            yield* Deferred.await(finishLifecycle);
            events.push("lifecycle-end");
          }),
        ),
        { startImmediately: true },
      );
      expect(yield* Deferred.isDone(lifecycleStarted)).toBe(false);
      yield* Deferred.succeed(finishCatalog, undefined);
      yield* Fiber.join(catalog);
      expect(yield* Deferred.isDone(lifecycleStarted)).toBe(false);
      yield* Deferred.succeed(finishHistory, undefined);
      yield* Fiber.join(history);
      yield* Deferred.await(lifecycleStarted);
      const laterRead = yield* Effect.forkChild(
        coordinator.runWorktreeRead(
          "/repo/task-1",
          Deferred.succeed(laterReadStarted, undefined).pipe(
            Effect.tap(() => Effect.sync(() => events.push("later-read"))),
          ),
        ),
        { startImmediately: true },
      );
      expect(yield* Deferred.isDone(laterReadStarted)).toBe(false);
      yield* coordinator.runWorktreeRead(
        "/repo/other-task",
        Effect.sync(() => events.push("other-read")),
      );
      yield* Deferred.succeed(finishLifecycle, undefined);
      yield* Fiber.join(lifecycle);
      yield* Fiber.join(laterRead);
    }),
  );
  expect(events).toEqual([
    "catalog-start",
    "history-start",
    "catalog-end",
    "history-end",
    "lifecycle-start",
    "other-read",
    "lifecycle-end",
    "later-read",
  ]);
});

test.each(["read", "lifecycle"] as const)(
  "interrupts a waiting worktree %s without retaining a lease",
  async (kind) => {
    const coordinator = createTaskSessionLifecycleCoordinator();
    const lease = <A, E, R>(mode: typeof kind, effect: Effect.Effect<A, E, R>) =>
      mode === "read"
        ? coordinator.runWorktreeRead("/repo/task-1", effect)
        : Effect.scoped(
            coordinator.acquireWorktreeLifecycle(["/repo/task-1"]).pipe(Effect.andThen(effect)),
          );
    await Effect.runPromise(
      Effect.gen(function* () {
        const held = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const waiterStarted = yield* Deferred.make<void>();
        const blocker = yield* Effect.forkChild(
          lease(
            kind === "read" ? "lifecycle" : "read",
            Deferred.succeed(held, undefined).pipe(Effect.andThen(Deferred.await(release))),
          ),
        );
        yield* Deferred.await(held);
        const waiter = yield* Effect.forkChild(
          lease(kind, Deferred.succeed(waiterStarted, undefined)),
          { startImmediately: true },
        );
        expect(yield* Deferred.isDone(waiterStarted)).toBe(false);
        yield* Fiber.interrupt(waiter);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(blocker);
        yield* lease(kind === "read" ? "lifecycle" : "read", Effect.void);
        expect(yield* Deferred.isDone(waiterStarted)).toBe(false);
      }),
    );
  },
);

test.each(["read", "lifecycle"] as const)(
  "interrupting an active worktree %s releases a waiting incompatible lease",
  async (kind) => {
    const coordinator = createTaskSessionLifecycleCoordinator();
    const lease = <A, E, R>(mode: typeof kind, effect: Effect.Effect<A, E, R>) =>
      mode === "read"
        ? coordinator.runWorktreeRead("/repo/task-1", effect)
        : Effect.scoped(
            coordinator.acquireWorktreeLifecycle(["/repo/task-1"]).pipe(Effect.andThen(effect)),
          );
    await Effect.runPromise(
      Effect.gen(function* () {
        const held = yield* Deferred.make<void>();
        const nextStarted = yield* Deferred.make<void>();
        const owner = yield* Effect.forkChild(
          lease(kind, Deferred.succeed(held, undefined).pipe(Effect.andThen(Effect.never))),
        );
        yield* Deferred.await(held);
        const next = yield* Effect.forkChild(
          lease(kind === "read" ? "lifecycle" : "read", Deferred.succeed(nextStarted, undefined)),
          { startImmediately: true },
        );
        expect(yield* Deferred.isDone(nextStarted)).toBe(false);
        yield* Fiber.interrupt(owner);
        yield* Fiber.join(next);
        expect(yield* Deferred.isDone(nextStarted)).toBe(true);
      }),
    );
  },
);

test("failed reads and lifecycle work release their leases", async () => {
  const coordinator = createTaskSessionLifecycleCoordinator();
  await Effect.runPromise(
    Effect.gen(function* () {
      const read = yield* Effect.forkChild(
        Effect.result(coordinator.runWorktreeRead("/repo/task-1", Effect.fail("read failed"))),
      );
      expect(yield* Fiber.join(read)).toMatchObject({ _tag: "Failure", failure: "read failed" });
      yield* Effect.scoped(coordinator.acquireWorktreeLifecycle(["/repo/task-1"]));
      const lifecycle = yield* Effect.forkChild(
        Effect.result(
          Effect.scoped(
            coordinator
              .acquireWorktreeLifecycle(["/repo/task-1"])
              .pipe(Effect.andThen(Effect.fail("lifecycle failed"))),
          ),
        ),
      );
      expect(yield* Fiber.join(lifecycle)).toMatchObject({
        _tag: "Failure",
        failure: "lifecycle failed",
      });
      yield* coordinator.runWorktreeRead("/repo/task-1", Effect.void);
    }),
  );
});

test("multi-path lifecycle acquires sorted paths and releases partial leases on interruption", async () => {
  const coordinator = createTaskSessionLifecycleCoordinator();
  await Effect.runPromise(
    Effect.gen(function* () {
      const secondHeld = yield* Deferred.make<void>();
      const releaseSecond = yield* Deferred.make<void>();
      const firstReadStarted = yield* Deferred.make<void>();
      const second = yield* Effect.forkChild(
        Effect.scoped(
          Effect.gen(function* () {
            yield* coordinator.acquireWorktreeLifecycle(["/repo/b"]);
            yield* Deferred.succeed(secondHeld, undefined);
            yield* Deferred.await(releaseSecond);
          }),
        ),
      );
      yield* Deferred.await(secondHeld);
      const multiple = yield* Effect.forkChild(
        Effect.scoped(coordinator.acquireWorktreeLifecycle(["/repo/b", "/repo/a", "/repo/a"])),
        { startImmediately: true },
      );
      const firstRead = yield* Effect.forkChild(
        coordinator.runWorktreeRead("/repo/a", Deferred.succeed(firstReadStarted, undefined)),
        { startImmediately: true },
      );
      expect(yield* Deferred.isDone(firstReadStarted)).toBe(false);
      yield* Fiber.interrupt(multiple);
      yield* Fiber.join(firstRead);
      yield* Deferred.succeed(releaseSecond, undefined);
      yield* Fiber.join(second);
      yield* Effect.all(
        [
          Effect.scoped(coordinator.acquireWorktreeLifecycle(["/repo/b", "/repo/a"])),
          Effect.scoped(coordinator.acquireWorktreeLifecycle(["/repo/a", "/repo/b"])),
        ],
        { concurrency: "unbounded" },
      );
    }),
  );
});

test("task lifecycle guard rejects overlap and releases at scope exit", async () => {
  const coordinator = createTaskSessionLifecycleCoordinator();
  let overlapFailed = false;

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* coordinator.acquireLifecycle("/repo", ["task-1"], "start workflow session");
        overlapFailed = yield* coordinator.acquireLifecycle("/repo", ["task-1"], "close task").pipe(
          Effect.scoped,
          Effect.result,
          Effect.map((result) => result._tag === "Failure"),
        );
      }),
    ),
  );

  expect(overlapFailed).toBe(true);
  await expect(
    Effect.runPromise(
      Effect.scoped(coordinator.acquireLifecycle("/repo", ["task-1"], "close task")),
    ),
  ).resolves.toBeUndefined();
});

test("workspace lifecycle and task lifecycle operations reject overlap", async () => {
  const coordinator = createTaskSessionLifecycleCoordinator();

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* coordinator.acquireLifecycle("/repo", ["task-1"], "direct merge");
        const workspaceLifecycle = yield* Effect.result(
          coordinator.runWorkspaceLifecycle("/repo", "close", Effect.void),
        );
        expect(workspaceLifecycle._tag).toBe("Failure");
      }),
    ),
  );

  await Effect.runPromise(
    coordinator.runWorkspaceLifecycle(
      "/repo",
      "remove",
      Effect.gen(function* () {
        const taskLifecycle = yield* Effect.result(
          Effect.scoped(coordinator.acquireLifecycle("/repo", ["task-1"], "direct merge")),
        );
        expect(taskLifecycle._tag).toBe("Failure");
      }),
    ),
  );

  await expect(
    Effect.runPromise(
      Effect.scoped(coordinator.acquireLifecycle("/repo", ["task-1"], "direct merge")),
    ),
  ).resolves.toBeUndefined();
});

test("constructing a task lifecycle Effect does not reserve the task", async () => {
  const coordinator = createTaskSessionLifecycleCoordinator();
  const start = coordinator.acquireLifecycle("/repo", ["task-1"], "start session");

  await expect(
    Effect.runPromise(
      Effect.scoped(coordinator.acquireLifecycle("/repo", ["task-1"], "close task")),
    ),
  ).resolves.toBeUndefined();
  await expect(Effect.runPromise(Effect.scoped(start))).resolves.toBeUndefined();
});

test("each execution of a task lifecycle Effect checks and reserves the task", async () => {
  const coordinator = createTaskSessionLifecycleCoordinator();
  const start = coordinator.acquireLifecycle("/repo", ["task-1"], "start session");
  await Effect.runPromise(Effect.scoped(start));

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* coordinator.acquireLifecycle("/repo", ["task-1"], "close task");
        const overlap = yield* Effect.result(Effect.scoped(start));
        expect(overlap._tag).toBe("Failure");
      }),
    ),
  );

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* start;
        const overlap = yield* Effect.result(
          Effect.scoped(coordinator.acquireLifecycle("/repo", ["task-1"], "close task")),
        );
        expect(overlap._tag).toBe("Failure");
      }),
    ),
  );
});
