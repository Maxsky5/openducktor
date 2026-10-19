import { expect, test } from "bun:test";
import type { WorkflowLaunchRequest } from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import { createNodeSessionLaunchControls } from "../../composition/node/node-session-launch-controls";
import { createLaunchHarness, modelFor, requestFor } from "./test-support/workflow-launch-harness";

const cases = (["fresh", "fork"] as const).flatMap((mode) =>
  (["preparation", "native", "hold"] as const).map((stage) => [mode, stage] as const),
);

test.each(cases)("shutdown cancels a %s launch during %s before saving", async (mode, stage) => {
  const { entered, release, pause } = await pausePoint();
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

test("Stop cancels an Autopilot message before the send starts", async () => {
  const wait = await pausePoint();
  const h = await createLaunchHarness("opencode", {
    beforeMessageOperation: wait.pause,
    keepAttachedOnStop: true,
  });
  h.setTaskStatus("in_progress");
  const source = h.addTaskSession("builder", { live: true });
  const ref = { repoPath: "/repo", ...source };
  const { commands } = createNodeSessionLaunchControls(h.commands, [h.service]);
  await Effect.runPromise(
    Effect.gen(function* () {
      const launch = yield* Effect.forkChild(
        h.launchAutomatic({
          ...requestFor("opencode"),
          policy: { kind: "automatic", actionId: "startReviewQaFeedbacks" },
        }),
      );
      yield* Deferred.await(wait.entered);
      yield* commands.stopSession(ref);
      expect(h.sends).toEqual([]);
      yield* wait.open;
      const result = yield* Fiber.join(launch);
      expect(result.status).toBe("canceled");
      expect(result.acceptedMessage).toBeUndefined();
    }).pipe(Effect.ensuring(wait.open)),
  );
  expect(h.sends).toEqual([]);
  expect(h.messageDelivery.listQueues("/repo")).toEqual([]);
});

test.each(["queue", "send"] as const)(
  "a canceled launch cannot %s after preparation waits",
  async (stage) => {
    const wait = await pausePoint();
    let preparingLaunch = false;
    const pauseLaunch = Effect.suspend(() => (preparingLaunch ? wait.pause : Effect.void));
    const h = await createLaunchHarness(
      "opencode",
      stage === "queue"
        ? { beforeMessagePreparation: pauseLaunch }
        : { beforeSendContext: pauseLaunch },
    );
    h.setTaskStatus("in_progress");
    const source = h.addTaskSession("builder", {
      live: true,
      working: stage === "queue",
    });
    const ref = { repoPath: "/repo", ...source };
    if (stage === "queue") {
      await Effect.runPromise(
        h.messageDelivery.submit({
          ...ref,
          sessionScope: { kind: "workflow", taskId: "task", role: "build" },
          submissionId: "earlier-message",
          mode: "default",
          parts: [{ kind: "text", text: "Earlier message" }],
        }),
      );
    }
    const sendsBefore = h.sends.length;
    preparingLaunch = true;
    await Effect.runPromise(
      Effect.gen(function* () {
        const launch = yield* Effect.forkChild(
          h.launchAutomatic({
            ...requestFor("opencode"),
            policy: { kind: "automatic", actionId: "startReviewQaFeedbacks" },
          }),
        );
        yield* Deferred.await(wait.entered);
        h.service.cancelSessionLaunches(ref);
        yield* wait.open;
        const result = yield* Fiber.join(launch);
        expect(result.status).toBe("canceled");
        expect(result.acceptedMessage).toBeUndefined();
      }).pipe(Effect.ensuring(wait.open)),
    );
    expect(h.sends).toHaveLength(sendsBefore);
    expect(
      h.messageDelivery
        .listQueues("/repo")
        .flatMap((queue) => queue.entries.map((entry) => entry.submissionId)),
    ).toEqual(stage === "queue" ? ["earlier-message"] : []);
  },
);

const pausePoint = async () => {
  const entered = await Effect.runPromise(Deferred.make<void>());
  const release = await Effect.runPromise(Deferred.make<void>());
  return {
    entered,
    release,
    pause: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
    open: Deferred.succeed(release, undefined),
  };
};
