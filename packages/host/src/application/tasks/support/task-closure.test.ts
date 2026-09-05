import type { TaskCard } from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import { createTaskSessionLifecycleCoordinator } from "../worktrees/task-session-lifecycle-coordinator";
import { completeTaskClosure } from "./task-closure";

const closureDependencies = () => ({
  gitPort: {
    canonicalizePath: (path: string) => Effect.succeed(path),
  },
  taskSessionLifecycleCoordinator: createTaskSessionLifecycleCoordinator(),
});

const closedTask = (): TaskCard => ({
  id: "task-1",
  title: "Task 1",
  description: "",
  status: "closed",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: false, completed: false },
    planner: { required: false, canSkip: true, available: false, completed: false },
    builder: { required: true, canSkip: false, available: false, completed: false },
    qa: { required: true, canSkip: false, available: false, completed: false },
  },
  updatedAt: "2026-01-02T03:04:05Z",
  createdAt: "2026-01-01T03:04:05Z",
});

test("keeps cleanup resources acquired until the task is closed", async () => {
  const calls: string[] = [];
  const taskStore: Pick<TaskStorePort, "transitionTask"> = {
    transitionTask(input) {
      return Effect.sync(() => {
        calls.push(`transition:${input.status}`);
        expect(calls).not.toContain("cleanup:release");
        return closedTask();
      });
    },
  };
  const cleanup = Effect.acquireRelease(
    Effect.sync(() => {
      calls.push("cleanup:acquire");
    }),
    () =>
      Effect.sync(() => {
        calls.push("cleanup:release");
      }),
  );

  await expect(
    Effect.runPromise(
      completeTaskClosure({
        ...closureDependencies(),
        cleanup,
        operation: "close task",
        repoPath: "/repo",
        taskId: "task-1",
        taskStore,
      }),
    ),
  ).resolves.toMatchObject({ id: "task-1", status: "closed" });
  expect(calls).toEqual(["cleanup:acquire", "transition:closed", "cleanup:release"]);
});

test("does not close the task when cleanup fails", async () => {
  let transitioned = false;
  const taskStore: Pick<TaskStorePort, "transitionTask"> = {
    transitionTask() {
      transitioned = true;
      return Effect.succeed(closedTask());
    },
  };
  const cleanup = Effect.fail(
    new HostOperationError({
      operation: "test.cleanup",
      message: "cleanup failed",
    }),
  );

  await expect(
    Effect.runPromise(
      completeTaskClosure({
        ...closureDependencies(),
        cleanup,
        operation: "close task",
        repoPath: "/repo",
        taskId: "task-1",
        taskStore,
      }),
    ),
  ).rejects.toThrow("cleanup failed");
  expect(transitioned).toBe(false);
});

test("holds the task lifecycle guard across cleanup and closure", async () => {
  const taskSessionLifecycleCoordinator = createTaskSessionLifecycleCoordinator();
  let lifecycleWasBlocked = false;
  const cleanup = Effect.gen(function* () {
    const lifecycle = yield* Effect.either(
      Effect.scoped(
        taskSessionLifecycleCoordinator.acquireLifecycle(
          "/canonical/repo",
          ["task-1"],
          "start workflow session",
        ),
      ),
    );
    lifecycleWasBlocked = lifecycle._tag === "Left";
  });
  const taskStore: Pick<TaskStorePort, "transitionTask"> = {
    transitionTask: () => Effect.succeed(closedTask()),
  };

  await Effect.runPromise(
    completeTaskClosure({
      cleanup,
      gitPort: {
        canonicalizePath: () => Effect.succeed("/canonical/repo"),
      },
      operation: "close task",
      repoPath: "/repo-link",
      taskId: "task-1",
      taskSessionLifecycleCoordinator,
      taskStore,
    }),
  );

  expect(lifecycleWasBlocked).toBe(true);
});

test("does not begin cleanup while another task lifecycle operation is active", async () => {
  const taskSessionLifecycleCoordinator = createTaskSessionLifecycleCoordinator();
  const acquired = await Effect.runPromise(Deferred.make<void>());
  const release = await Effect.runPromise(Deferred.make<void>());
  const holder = Effect.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        yield* taskSessionLifecycleCoordinator.acquireLifecycle(
          "/canonical/repo",
          ["task-1"],
          "start workflow session",
        );
        yield* Deferred.succeed(acquired, undefined);
        yield* Deferred.await(release);
      }),
    ),
  );
  await Effect.runPromise(Deferred.await(acquired));
  let cleanupStarted = false;
  let transitioned = false;
  const taskStore: Pick<TaskStorePort, "transitionTask"> = {
    transitionTask: () => {
      transitioned = true;
      return Effect.succeed(closedTask());
    },
  };

  await expect(
    Effect.runPromise(
      completeTaskClosure({
        cleanup: Effect.sync(() => {
          cleanupStarted = true;
        }),
        gitPort: {
          canonicalizePath: () => Effect.succeed("/canonical/repo"),
        },
        operation: "close task",
        repoPath: "/repo-link",
        taskId: "task-1",
        taskSessionLifecycleCoordinator,
        taskStore,
      }),
    ),
  ).rejects.toThrow("another lifecycle operation is in progress");
  await Effect.runPromise(Deferred.succeed(release, undefined));
  await Effect.runPromise(Fiber.join(holder));
  expect(cleanupStarted).toBe(false);
  expect(transitioned).toBe(false);
});
