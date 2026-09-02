import { expect, test } from "bun:test";
import { Effect } from "effect";
import { createTaskSessionBootstrapCoordinator } from "./task-session-bootstrap-coordinator";

test("worktree lifecycle waits for active reads and blocks new reads", async () => {
  const coordinator = createTaskSessionBootstrapCoordinator();
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

test("bootstrap lock does not block reads after worktree setup", async () => {
  const coordinator = createTaskSessionBootstrapCoordinator();
  const events: string[] = [];

  await Effect.runPromise(coordinator.acquireBootstrap("/repo", "task-1", "bootstrap-1", "build"));
  const read = Effect.runPromise(
    coordinator.runWorktreeRead(
      "/repo/task-1",
      Effect.sync(() => events.push("read")),
    ),
  );
  try {
    await Promise.resolve();
    expect(events).toEqual(["read"]);
  } finally {
    await Effect.runPromise(
      coordinator.finishBootstrap("/repo", "task-1", "bootstrap-1", "completed"),
    );
    await read;
  }
});
