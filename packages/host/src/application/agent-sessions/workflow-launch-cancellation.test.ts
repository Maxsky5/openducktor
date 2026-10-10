import { expect, test } from "bun:test";
import type { WorkflowLaunchRequest } from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import { createLaunchHarness, modelFor, requestFor } from "./test-support/workflow-launch-harness";

const cases = (["fresh", "fork"] as const).flatMap((mode) =>
  (["preparation", "native", "hold"] as const).map((stage) => [mode, stage] as const),
);

test.each(cases)("shutdown cancels a %s launch during %s before saving", async (mode, stage) => {
  const entered = await Effect.runPromise(Deferred.make<void>());
  const release = await Effect.runPromise(Deferred.make<void>());
  const pause = Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)));
  const h = await createLaunchHarness(
    "codex",
    stage === "hold"
      ? { startingHold: pause }
      : stage === "native"
        ? mode === "fresh"
          ? { nativeStart: pause }
          : { nativeFork: pause }
        : mode === "fresh"
          ? { beforePrepare: pause }
          : { forkSourceRead: pause },
  );
  let request: WorkflowLaunchRequest = requestFor("codex");
  if (mode === "fresh") h.setWorktreeExists(false);
  else {
    h.enablePullRequests();
    h.setTaskStatus("human_review");
    const sourceSession = h.addTaskSession("parent");
    request = {
      ...request,
      policy: {
        kind: "manual",
        actionId: "build_pull_request_generation",
        decision: { startMode: "fork", sourceSession, selectedModel: modelFor("codex") },
      },
    };
  }
  await Effect.runPromise(
    Effect.gen(function* () {
      const launch = yield* Effect.forkChild(h.service.launch(request));
      yield* Deferred.await(entered);
      const shutdown = yield* Effect.forkChild(h.service.shutdown());
      for (let index = 0; index < 20; index += 1) yield* Effect.yieldNow;
      // Native creation and the starting hold cannot be interrupted, so shutdown waits for them.
      // Shutdown interrupts preparation at once.
      expect(shutdown.pollUnsafe() === undefined).toBe(stage !== "preparation");
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(shutdown);
      const result = yield* Fiber.join(launch);
      expect(result.status).toBe("canceled");
      expect(result.session).toBeUndefined();
      expect(result.acceptedMessage).toBeUndefined();
      expect(result.unsentInstruction).toBeUndefined();
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined))),
  );
  expect(h.starts).toEqual(mode === "fresh" && stage !== "preparation" ? ["session-1"] : []);
  expect(h.forks).toEqual(mode === "fork" && stage !== "preparation" ? ["parent"] : []);
  expect(h.sends).toEqual([]);
  // The start cleanup stops the unsaved session once. Settlement does not stop it again.
  expect(h.stops).toEqual(
    stage === "preparation" ? [] : [mode === "fresh" ? "session-1" : "fork-1"],
  );
  expect(h.records.map((record) => record.externalSessionId)).toEqual(
    mode === "fresh" ? [] : ["parent"],
  );
  expect(h.getTask().status).toBe(mode === "fresh" ? "ready_for_dev" : "human_review");
  // Shutdown before preparation creates no worktree. A later stage rolls back the new worktree.
  const rolledBack = mode === "fresh" && stage !== "preparation";
  expect(h.removedWorktrees).toEqual(rolledBack ? ["/worktrees/task"] : []);
  expect(h.deletedBranches).toEqual(rolledBack ? ["odt/task-task"] : []);
});
