import type {
  BackgroundOperationSnapshot,
  FailedBackgroundOperation,
} from "@openducktor/contracts";
import { Deferred, Effect, Exit, Fiber } from "effect";
import {
  backgroundOperationFailureProgress,
  backgroundStep,
  planBackgroundSteps,
} from "../../application/operation-progress/background-operation-progress";
import { HostOperationError } from "../../effect/host-errors";
import { createHostEventBus } from "../../events/host-event-bus";
import { createEffectHostCommandRouter } from "../../interface/router/host-command-router";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";
import { createNodeBackgroundOperationTracker } from "./node-background-operation-progress";

test("a tracked command finishes after its caller leaves and preserves evidence before a later failure", async () => {
  const workspace = { workspaceId: "workspace", repoPath: "/repo" };
  const entered = Deferred.makeUnsafe<void>();
  const proceed = Deferred.makeUnsafe<void>();
  const done = Deferred.makeUnsafe<FailedBackgroundOperation>();
  const failure = new HostOperationError({
    operation: "remove-branch",
    message: "Branch is checked out elsewhere.",
  });
  const eventBus = createHostEventBus({
    report: ({ cause }) => {
      throw cause;
    },
  });
  const tracker = createNodeBackgroundOperationTracker({
    hostInstanceId: "host",
    settings: {
      getRepoConfig: () => Effect.succeed(repoConfigFixture(workspace)),
    },
    eventBus,
  });
  const snapshots: BackgroundOperationSnapshot[] = [];
  const stop = eventBus.subscribe("openducktor://background-operation-progress", (event) => {
    if (event.channel !== "openducktor://background-operation-progress") return;
    snapshots.push(event.payload);
    if (event.payload.phase === "failed") Deferred.doneUnsafe(done, Effect.succeed(event.payload));
  });
  const remove = { id: "worktrees", label: "Remove worktree" };
  const branches = { id: "branches", label: "Delete branch" };
  const later = { id: "later", label: "Finish cleanup" };
  const router = createEffectHostCommandRouter({
    dispose: tracker.shutdown,
    trackBackgroundOperation: tracker.track,
    handlers: {
      task_worktree_remove(args) {
        expect(args).toEqual({ ...workspace, taskId: "task" });
        return Effect.gen(function* () {
          yield* planBackgroundSteps(remove, branches, later);
          yield* backgroundStep(remove, Effect.void, () => ({
            resources: [{ kind: "worktree", value: "/worktrees/task", state: "removed" }],
          }));
          yield* backgroundStep(
            branches,
            Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(proceed);
              return yield* failure;
            }),
          );
        });
      },
    },
  });

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const input = { ...workspace, taskId: "task", operationId: crypto.randomUUID() };
        const caller = yield* Effect.forkChild(router.invoke("task_worktree_remove", input));
        yield* Deferred.await(entered);
        const refused = yield* Effect.exit(
          router.invoke("task_worktree_remove", { ...input, operationId: crypto.randomUUID() }),
        );
        expect(Exit.isFailure(refused)).toBe(true);
        yield* Fiber.interrupt(caller);
        yield* Deferred.succeed(proceed, undefined);
        const result = yield* Deferred.await(done);
        expect(result.steps).toMatchObject([
          {
            ...remove,
            state: "completed",
            resources: [{ value: "/worktrees/task", state: "removed" }],
          },
          { ...branches, state: "failed", failure: { message: failure.message } },
          { ...later, state: "not_run" },
        ]);
        expect(
          snapshots.every((snapshot) => snapshot.steps.every((step) => step.id !== "request")),
        ).toBe(true);
        expect(snapshots.every((snapshot, index) => snapshot.revision === index + 1)).toBe(true);
        expect(backgroundOperationFailureProgress(failure)).toEqual(result);
      }),
    );
  } finally {
    stop();
    await Effect.runPromise(router.dispose());
  }
});

test("a refusal before any work reports its reason without a progress step", async () => {
  const workspace = { workspaceId: "workspace", repoPath: "/repo" };
  const tracker = createNodeBackgroundOperationTracker({
    hostInstanceId: "host",
    settings: { getRepoConfig: () => Effect.succeed(repoConfigFixture(workspace)) },
    eventBus: undefined,
  });
  const failure = new HostOperationError({
    operation: "archive",
    message: "The branch changed. Reopen Archive session and confirm the current branch.",
  });
  try {
    const result = await Effect.runPromise(
      tracker
        .track(
          "workspace_session_archive",
          { workspaceId: workspace.workspaceId, sessionId: "session" },
          crypto.randomUUID(),
          Effect.fail(failure),
        )
        .pipe(Effect.result),
    );
    expect(result).toMatchObject({ _tag: "Failure", failure });
    expect(backgroundOperationFailureProgress(failure)).toMatchObject({
      phase: "failed",
      failure: { message: failure.message },
      steps: [],
    });
  } finally {
    await Effect.runPromise(tracker.shutdown());
  }
});
