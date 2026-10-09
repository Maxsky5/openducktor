import { expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import { createTaskSessionLifecycleCoordinator } from "./task-session-lifecycle-coordinator";

test("worktree lifecycle waits for active reads and blocks new reads", async () => {
  const coordinator = createTaskSessionLifecycleCoordinator();
  const events: string[] = [];
  let finishRead = () => {};
  let finishLifecycle = () => {};
  let markReadStarted = () => {};
  let markLifecycleStarted = () => {};
  const readFinished = new Promise<void>((resolve) => {
    finishRead = resolve;
  });
  const lifecycleFinished = new Promise<void>((resolve) => {
    finishLifecycle = resolve;
  });
  const readStarted = new Promise<void>((resolve) => {
    markReadStarted = resolve;
  });
  const lifecycleStarted = new Promise<void>((resolve) => {
    markLifecycleStarted = resolve;
  });

  const firstRead = Effect.runPromise(
    coordinator.runWorktreeRead(
      "/repo/task-1",
      Effect.gen(function* () {
        events.push("read-start");
        markReadStarted();
        yield* Effect.promise(() => readFinished);
        events.push("read-end");
      }),
    ),
  );
  await readStarted;

  const lifecycle = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* coordinator.acquireWorktreeLifecycle(["/repo/task-1"]);
        events.push("lifecycle-start");
        markLifecycleStarted();
        yield* Effect.promise(() => lifecycleFinished);
        events.push("lifecycle-end");
      }),
    ),
  );
  finishRead();
  await lifecycleStarted;

  const secondRead = Effect.runPromise(
    coordinator.runWorktreeRead(
      "/repo/task-1",
      Effect.sync(() => events.push("second-read")),
    ),
  );
  finishLifecycle();

  await Promise.all([firstRead, lifecycle, secondRead]);
  expect(events).toEqual([
    "read-start",
    "read-end",
    "lifecycle-start",
    "lifecycle-end",
    "second-read",
  ]);
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

test("an inherited launch permit expires before a later reservation owns the task", async () => {
  const coordinator = createTaskSessionLifecycleCoordinator();
  await Effect.runPromise(
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const staleWorker = yield* coordinator.runReservedTaskOperation(
        "/repo",
        "task",
        Effect.forkDetach(
          Deferred.await(gate).pipe(
            Effect.andThen(
              Effect.result(
                Effect.scoped(
                  coordinator.acquireLifecycle("/repo", ["task"], "late internal operation"),
                ),
              ),
            ),
          ),
        ),
      );
      yield* coordinator.runReservedTaskOperation(
        "/repo",
        "task",
        Effect.gen(function* () {
          yield* Deferred.succeed(gate, undefined);
          const attempted = yield* Fiber.join(staleWorker);
          expect(attempted._tag).toBe("Failure");
          yield* Effect.scoped(
            coordinator.acquireLifecycle("/repo", ["task"], "current internal operation"),
          );
        }),
      );
    }),
  );
});
