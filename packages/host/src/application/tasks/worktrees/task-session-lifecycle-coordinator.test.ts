import { expect, test } from "bun:test";
import { Effect } from "effect";
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
          Effect.either,
          Effect.map((result) => result._tag === "Left"),
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
