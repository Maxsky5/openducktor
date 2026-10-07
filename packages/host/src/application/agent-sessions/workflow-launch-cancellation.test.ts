import { expect, test } from "bun:test";
import type { WorkflowLaunchRequest } from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import {
  createLaunchHarness,
  modelFor,
  requestFor,
  timestamp,
} from "./test-support/workflow-launch-harness";

const cases = (["fresh", "fork"] as const).flatMap((mode) =>
  (["cancel", "shutdown"] as const).flatMap((action) =>
    (["preparation", "native", "hold"] as const).map((stage) => [mode, action, stage] as const),
  ),
);

test.each(cases)("%s launch honors %s during %s before saving", async (mode, action, stage) => {
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
          ? { preparedStart: pause }
          : { forkSourceRead: pause },
  );
  let request: WorkflowLaunchRequest = requestFor("codex");
  if (mode === "fresh") h.setWorktreeExists(false);
  else {
    h.enablePullRequests();
    h.setTaskStatus("human_review");
    h.records.push({
      externalSessionId: "parent",
      runtimeKind: "codex",
      workingDirectory: "/worktrees/task",
      role: "build",
      startedAt: timestamp,
      selectedModel: modelFor("codex"),
    });
    request = {
      ...request,
      policy: {
        kind: "manual",
        actionId: "build_pull_request_generation",
        decision: {
          startMode: "fork",
          sourceSession: {
            externalSessionId: "parent",
            runtimeKind: "codex",
            workingDirectory: "/worktrees/task",
          },
          selectedModel: modelFor("codex"),
        },
      },
    };
  }
  await Effect.runPromise(
    Effect.gen(function* () {
      const launch = yield* Effect.forkChild(h.service.launch(request));
      yield* Deferred.await(entered);
      const cancellation = yield* Effect.forkChild(
        action === "cancel" ? h.service.cancel(request).pipe(Effect.asVoid) : h.service.shutdown(),
      );
      yield* Effect.yieldNow;
      expect(cancellation.pollUnsafe()).toBeUndefined();
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(cancellation);
      const result = yield* Fiber.join(launch);
      expect(result).toMatchObject({
        phase: "canceled",
        acceptance: "not_submitted",
        ownershipSaved: false,
        recoveryAllowed: false,
      });
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined))),
  );
  expect(h.starts).toEqual(mode === "fresh" && stage !== "preparation" ? ["session-1"] : []);
  expect(h.forks).toEqual(mode === "fork" && stage !== "preparation" ? ["parent"] : []);
  expect(h.sends).toEqual([]);
  expect(h.stops).toEqual(
    stage === "preparation" ? [] : [mode === "fresh" ? "session-1" : "fork-1"],
  );
  expect(h.records.map((record) => record.externalSessionId)).toEqual(
    mode === "fresh" ? [] : ["parent"],
  );
  expect(h.getTask().status).toBe(mode === "fresh" ? "ready_for_dev" : "human_review");
  expect(h.removedWorktrees).toEqual(mode === "fresh" ? ["/worktrees/task"] : []);
  expect(h.deletedBranches).toEqual(mode === "fresh" ? ["odt/task-task"] : []);
});
