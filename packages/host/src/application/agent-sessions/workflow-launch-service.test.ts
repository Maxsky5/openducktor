import { expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import { agentSessionLiveEnvelopeSchema } from "@openducktor/contracts";
import type {
  AgentSessionControlSendInput,
  WorkflowLaunchRequest,
  WorkflowLaunchDecision,
  WorkflowLaunchSnapshot,
} from "@openducktor/contracts";
import {
  createLaunchHarness,
  requestFor,
  modelFor,
  timestamp,
  failure,
} from "./test-support/workflow-launch-harness";
import { createNodeSessionLaunchControls } from "../../composition/node/node-session-launch-controls";
import { createWorkflowLaunchCommandHandlers } from "../../interface/commands/agent-session-live-command-handlers";

test.each(["codex", "claude", "opencode"] as const)(
  "%s publishes saved task ownership before the first native send",
  async (runtimeKind) => {
    const h = await createLaunchHarness(runtimeKind);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const release = yield* Deferred.make<void>();
          h.setSendGate(Deferred.await(release));
          const launch = yield* Effect.forkChild(h.service.launch(requestFor(runtimeKind)));
          yield* Deferred.await(h.sendEntered);
          expect(
            h.envelopes.map((event) => agentSessionLiveEnvelopeSchema.parse(event)),
          ).toContainEqual({
            type: "task_session_records_updated",
            repoPath: "/repo",
            taskId: "task",
            agentSessions: h.records,
            liveSession: expect.objectContaining({
              activity: "running",
              ref: expect.objectContaining({ runtimeKind }),
            }),
          });
          yield* Deferred.succeed(release, undefined);
          expect((yield* Fiber.join(launch)).phase).toBe("completed");
        }),
      ),
    );
  },
);

test("task startup failure keeps saved ownership but blocks message recovery", async () => {
  const h = await createLaunchHarness("codex", {
    completion: Effect.fail(failure("Task transition failed")),
  });
  const request = requestFor("codex");
  const result = await Effect.runPromise(h.service.launch(request));
  expect(result).toMatchObject({
    phase: "failed",
    ownershipSaved: true,
    acceptance: "not_submitted",
    recoveryAllowed: false,
    failure: { message: "Task transition failed" },
  });
  expect(h.records).toHaveLength(1);
  expect(h.getTask().status).toBe("ready_for_dev");
  await expect(Effect.runPromise(h.service.recover(request))).rejects.toThrow(
    "recovery is unavailable",
  );
  expect(h.sends).toEqual([]);
  expect(h.resumes).toEqual([]);
});

test.each(["rejected", "not_submitted"] as const)(
  "Cancel keeps recovery disabled for a settled task launch with %s acceptance",
  async (acceptance) => {
    const h = await createLaunchHarness();
    if (acceptance === "rejected") h.setSendFailure("rejected");
    else h.setPublishFailure();
    const request = requestFor("codex");
    const failed = await Effect.runPromise(h.service.launch(request));
    expect(failed.acceptance).toBe(acceptance);
    expect(failed.recoveryAllowed).toBe(acceptance === "rejected");
    const ref = {
      launchAttemptId: request.launchAttemptId,
      workspaceId: request.workspaceId,
      repoPath: request.repoPath,
      taskId: request.taskId,
    };
    const commands = createWorkflowLaunchCommandHandlers(h.service);
    const publications = h.snapshots.length;
    const canceled = await Effect.runPromise(commands.agent_session_workflow_launch_cancel(ref));
    expect(canceled).toEqual({
      ...failed,
      phase: acceptance === "rejected" ? "canceled" : "failed",
      recoveryAllowed: false,
    });
    expect((await Effect.runPromise(h.service.read(ref)))[0]).toEqual(canceled);
    expect(h.snapshots.slice(publications)).toEqual(acceptance === "rejected" ? [canceled] : []);
    expect(await Effect.runPromise(commands.agent_session_workflow_launch_cancel(ref))).toEqual(
      canceled,
    );
    expect(h.snapshots.slice(publications)).toEqual(acceptance === "rejected" ? [canceled] : []);
    await expect(Effect.runPromise(h.service.recover(ref))).rejects.toThrow(
      "recovery is unavailable",
    );
    expect(h.sends).toHaveLength(acceptance === "rejected" ? 1 : 0);
    expect(h.stops).toHaveLength(0);
  },
);

test("Cancel reports a failed publication and keeps recovery disabled", async () => {
  const h = await createLaunchHarness("codex", {
    canceledPublication: Effect.fail(failure("Cancellation publication failed")),
  });
  h.setSendFailure("rejected");
  const request = requestFor("codex");
  await Effect.runPromise(h.service.launch(request));
  const result = await Effect.runPromise(Effect.result(h.service.cancel(request)));
  expect(result._tag).toBe("Failure");
  if (result._tag === "Failure")
    expect(result.failure.message).toContain("Cancellation publication failed");
  expect((await Effect.runPromise(h.service.read(request)))[0]).toMatchObject({
    phase: "canceled",
    recoveryAllowed: false,
  });
});

test.each(["rejected", "not_submitted"] as const)(
  "Stop keeps recovery disabled for a settled task launch with %s acceptance",
  async (acceptance) => {
    const h = await createLaunchHarness();
    if (acceptance === "rejected") h.setSendFailure("rejected");
    else h.setPublishFailure();
    const request = requestFor("codex");
    const failed = await Effect.runPromise(h.service.launch(request));
    expect(failed.acceptance).toBe(acceptance);
    expect(failed.recoveryAllowed).toBe(acceptance === "rejected");
    const { commands } = createNodeSessionLaunchControls(h.runtime, [h.service]);
    await Effect.runPromise(
      commands.stopSession({ repoPath: request.repoPath, ...failed.session! }),
    );
    const [stopped] = await Effect.runPromise(h.service.read(request));
    const phase = acceptance === "rejected" ? "canceled" : "failed";
    expect(stopped).toMatchObject({ phase, recoveryAllowed: false });
    expect(stopped?.session).toEqual(failed.session);
    expect(stopped?.failure).toEqual(failed.failure);
    await expect(Effect.runPromise(h.service.recover(request))).rejects.toThrow(
      "recovery is unavailable",
    );
    expect(h.sends).toHaveLength(acceptance === "rejected" ? 1 : 0);
    expect(h.stops).toEqual([failed.session!.externalSessionId]);
    expect(h.snapshots.at(-1)).toMatchObject({ phase, recoveryAllowed: false });
  },
);

test.each(["succeeds", "fails"] as const)(
  "Stop still runs after recovery publication fails, native Stop %s",
  async (outcome) => {
    const stopFails = outcome === "fails";
    const h = await createLaunchHarness("codex", {
      canceledPublication: Effect.fail(failure("Recovery publication failed")),
    });
    h.setSendFailure("rejected");
    const request = requestFor("codex");
    const failed = await Effect.runPromise(h.service.launch(request));
    if (stopFails) h.setStopFailure("rejected");
    const { commands } = createNodeSessionLaunchControls(h.runtime, [h.service]);
    const result = await Effect.runPromise(
      Effect.result(commands.stopSession({ repoPath: request.repoPath, ...failed.session! })),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure.message).toContain("Recovery publication failed");
      if (stopFails) expect(result.failure.message).toContain("Exact stop failure");
    }
    expect(h.stops).toEqual([failed.session!.externalSessionId]);
    expect((await Effect.runPromise(h.service.read(request)))[0]?.recoveryAllowed).toBe(false);
  },
);

test("Stop leaves a different task session's recovery available", async () => {
  const h = await createLaunchHarness();
  h.setSendFailure("rejected");
  const firstRequest = requestFor("codex", "first");
  const secondRequest = requestFor("codex", "second");
  const first = await Effect.runPromise(h.service.launch(firstRequest));
  const second = await Effect.runPromise(h.service.launch(secondRequest));
  expect(first.recoveryAllowed).toBe(true);
  expect(second.recoveryAllowed).toBe(true);
  const { commands } = createNodeSessionLaunchControls(h.runtime, [h.service]);
  await Effect.runPromise(
    commands.stopSession({ repoPath: firstRequest.repoPath, ...first.session! }),
  );
  expect((await Effect.runPromise(h.service.read(secondRequest)))[0]?.recoveryAllowed).toBe(true);
  h.setSendFailure(null);
  expect((await Effect.runPromise(h.service.recover(secondRequest))).acceptance).toBe("accepted");
  expect(h.sends.at(-1)?.externalSessionId).toBe(second.session!.externalSessionId);
});

test("a closed runtime gate permits recovery without a second session", async () => {
  const h = await createLaunchHarness();
  h.setStoreGate(
    Effect.sync(() =>
      h.runtimeAdmission.close("codex", {
        state: "stopping",
        message: "The runtime is stopping.",
        nextAction: "Restart the runtime.",
      }),
    ),
  );
  const request = requestFor("codex");
  const failed = await Effect.runPromise(h.service.launch(request));
  expect(failed.acceptance).toBe("rejected");
  expect(failed.recoveryAllowed).toBe(true);
  expect(h.sends).toHaveLength(0);
  h.runtimeAdmission.open("codex");
  expect((await Effect.runPromise(h.service.recover(request))).acceptance).toBe("accepted");
  expect(h.starts).toHaveLength(1);
  expect(h.sends).toHaveLength(1);
});

test("automatic actions for one task wait for the prior launch to finish", async () => {
  const h = await createLaunchHarness();
  const release = await Effect.runPromise(Deferred.make<void>());
  h.setSendGate(Deferred.await(release));
  await Effect.runPromise(
    Effect.gen(function* () {
      const planner = yield* Effect.forkChild(
        h.service.launch({
          ...requestFor("codex", "planner"),
          policy: { kind: "automatic", actionId: "startPlanner" },
        }),
      );
      yield* Deferred.await(h.sendEntered);
      const request: WorkflowLaunchRequest = {
        ...requestFor("codex", "builder"),
        policy: { kind: "automatic", actionId: "startBuilder" },
      };
      const builder = yield* Effect.forkChild(h.service.launch(request));
      yield* Effect.yieldNow;
      expect((yield* h.service.read(request))[0]?.phase).toBe("queued");
      expect(h.starts).toEqual(["session-1"]);
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(planner)).toMatchObject({
        phase: "completed",
        acceptance: "accepted",
      });
      expect(yield* Fiber.join(builder)).toMatchObject({
        phase: "completed",
        acceptance: "accepted",
      });
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined))),
  );
  expect(h.records.map((record) => record.role)).toEqual(["planner", "build"]);
  expect(h.sends.map((input) => input.externalSessionId)).toEqual(["session-1", "session-2"]);
  expect(h.getTask().status).toBe("in_progress");
});

test("Stop cancels every queued reuse before it waits for launch publication", async () => {
  const publishing = await Effect.runPromise(Deferred.make<void>());
  const releasePublication = await Effect.runPromise(Deferred.make<void>());
  const nextPublication = await Effect.runPromise(Deferred.make<void>());
  const nextSend = await Effect.runPromise(Deferred.make<void>());
  let publications = 0;
  const h = await createLaunchHarness("codex", {
    canceledPublication: Effect.suspend(() =>
      ++publications === 1
        ? Deferred.succeed(publishing, undefined).pipe(
            Effect.andThen(Deferred.await(releasePublication)),
          )
        : Deferred.succeed(nextPublication, undefined).pipe(Effect.asVoid),
    ),
  });
  const saved = await Effect.runPromise(
    h.service.launch({
      ...requestFor("codex", "source"),
      instruction: { kind: "none" },
    }),
  );
  const request: WorkflowLaunchRequest = {
    ...requestFor("codex", "first"),
    queueIfBusy: true,
    policy: {
      kind: "manual",
      actionId: "build_after_qa_rejected",
      decision: { startMode: "reuse", sourceSession: saved.session! },
    },
  };
  const { commands } = createNodeSessionLaunchControls(h.runtime, [h.service]);
  await Effect.runPromise(
    Effect.gen(function* () {
      const releaseSend = yield* Deferred.make<void>();
      h.setSendGate(
        Effect.suspend(() =>
          h.sends.length === 1
            ? Deferred.await(releaseSend)
            : Deferred.succeed(nextSend, undefined).pipe(Effect.asVoid),
        ),
      );
      const first = yield* Effect.forkChild(h.service.launch(request));
      yield* Deferred.await(h.sendEntered);
      const second = yield* Effect.forkChild(
        h.service.launch({ ...request, launchAttemptId: "second" }),
      );
      yield* Effect.yieldNow;
      const [queued] = yield* h.service.read({ ...request, launchAttemptId: "second" });
      expect(queued?.phase).toBe("queued");
      const stop = yield* Effect.forkChild(
        commands.stopSession({ repoPath: request.repoPath, ...saved.session! }),
      );
      yield* Effect.yieldNow;
      yield* Deferred.succeed(releaseSend, undefined);
      yield* Deferred.await(publishing);
      // Wait for the next worker's send or canceled publication while Stop still waits.
      yield* Effect.race(Deferred.await(nextSend), Deferred.await(nextPublication));
      yield* Deferred.succeed(releasePublication, undefined);
      expect(yield* Fiber.join(first)).toMatchObject({ phase: "canceled", acceptance: "accepted" });
      expect(yield* Fiber.join(second)).toMatchObject({
        phase: "canceled",
        acceptance: "not_submitted",
      });
      yield* Fiber.join(stop);
    }).pipe(Effect.ensuring(Deferred.succeed(releasePublication, undefined))),
  );
  expect(h.sends).toHaveLength(1);
  expect(h.stops).toEqual([saved.session!.externalSessionId]);
});

test.each(["stopped", "other", "fresh"] as const)(
  "Stop during queued automatic QA preserves the %s session choice",
  async (choice) => {
    const h = await createLaunchHarness();
    h.settings.autopilot.alwaysStartQaReviewsFresh = choice === "fresh";
    h.setTaskStatus("ai_review");
    const qaRequest: WorkflowLaunchRequest = {
      ...requestFor("codex", "qa-source"),
      policy: {
        kind: "manual",
        actionId: "qa_review",
        decision: { startMode: "fresh", selectedModel: modelFor("codex") },
      },
      instruction: { kind: "none" },
    };
    const source = await Effect.runPromise(h.service.launch(qaRequest));
    let other: WorkflowLaunchSnapshot | undefined;
    if (choice === "other") {
      h.records[0]!.startedAt = "2026-10-02T12:00:00.000Z";
      other = await Effect.runPromise(
        h.service.launch({ ...qaRequest, launchAttemptId: "other-qa" }),
      );
    }
    h.setTaskStatus("in_progress");
    const release = await Effect.runPromise(Deferred.make<void>());
    h.setSendGate(Deferred.await(release));
    const request: WorkflowLaunchRequest = {
      ...requestFor("codex", "queued-qa"),
      policy: { kind: "automatic", actionId: "startQa" },
    };
    const { commands } = createNodeSessionLaunchControls(h.runtime, [h.service]);
    await Effect.runPromise(
      Effect.gen(function* () {
        const builder = yield* Effect.forkChild(h.service.launch(requestFor("codex", "builder")));
        yield* Deferred.await(h.sendEntered);
        h.setTaskStatus("ai_review");
        const automatic = yield* Effect.forkChild(h.service.launch(request));
        yield* Effect.yieldNow;
        expect((yield* h.service.read(request))[0]).toMatchObject({ phase: "queued" });
        yield* commands.stopSession({ repoPath: request.repoPath, ...source.session! });
        expect(h.sends).toHaveLength(1);
        yield* Deferred.succeed(release, undefined);
        expect((yield* Fiber.join(builder)).phase).toBe("completed");
        const result = yield* Fiber.join(automatic);
        if (choice === "stopped") {
          expect(result).toMatchObject({
            phase: "canceled",
            acceptance: "not_submitted",
            ownershipSaved: false,
            recoveryAllowed: false,
          });
          expect(h.sends).toHaveLength(1);
        } else {
          expect(result).toMatchObject({ phase: "completed", acceptance: "accepted" });
          expect(result.session?.externalSessionId).not.toBe(source.session!.externalSessionId);
          if (other)
            expect(result.session?.externalSessionId).toBe(other.session!.externalSessionId);
          expect(h.sends).toHaveLength(2);
        }
        expect(h.resumes).toHaveLength(0);
        expect(h.stops).toEqual([source.session!.externalSessionId]);
        expect(h.snapshots.at(-1)).toEqual(result);
        if (choice === "stopped") {
          const later = yield* h.service.launch({ ...request, launchAttemptId: "later-qa" });
          expect(later).toMatchObject({ phase: "completed", acceptance: "accepted" });
          expect(later.session?.externalSessionId).toBe(source.session!.externalSessionId);
          expect(h.resumes).toEqual([source.session!.externalSessionId]);
          expect(h.sends).toHaveLength(2);
        }
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined))),
    );
  },
);

test.each(["manual", "automatic", "fork"] as const)(
  "Stop during %s preparation prevents a later reuse send without canceling a fork child",
  async (mode) => {
    const entered = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    let paused = false;
    const gate = Effect.suspend(() =>
      paused
        ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
        : Effect.void,
    );
    const h = await createLaunchHarness(
      "codex",
      mode === "automatic" ? { catalog: gate } : { preparingPublication: gate },
    );
    const original = await Effect.runPromise(h.service.launch(requestFor("codex", "source")));
    const sourceSession = original.session!;
    h.sends.splice(0);
    if (mode === "fork") {
      h.enablePullRequests();
      h.setTaskStatus("human_review");
    }
    const request: WorkflowLaunchRequest = {
      ...requestFor("codex"),
      policy:
        mode === "automatic"
          ? { kind: "automatic", actionId: "startReviewQaFeedbacks" }
          : {
              kind: "manual",
              actionId:
                mode === "fork" ? "build_pull_request_generation" : "build_after_qa_rejected",
              decision:
                mode === "fork"
                  ? { startMode: "fork", sourceSession, selectedModel: modelFor("codex") }
                  : { startMode: "reuse", sourceSession },
            },
    };
    const ref = { repoPath: request.repoPath, ...sourceSession };
    const { commands } = createNodeSessionLaunchControls(h.runtime, [h.service]);
    paused = true;
    await Effect.runPromise(
      Effect.gen(function* () {
        const launch = yield* Effect.forkChild(h.service.launch(request));
        yield* Deferred.await(entered);
        const [attempt] = yield* h.service.read(request);
        expect(attempt?.session).toBeUndefined();
        const stop = yield* Effect.forkChild(commands.stopSession(ref));
        yield* Effect.yieldNow;
        const stoppedEarly = stop.pollUnsafe() !== undefined;
        yield* Deferred.succeed(release, undefined);
        const result = yield* Fiber.join(launch);
        yield* Fiber.join(stop);
        expect(result.phase).toBe(mode === "fork" ? "completed" : "canceled");
        expect(stoppedEarly).toBe(mode === "fork");
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined))),
    );
    expect(h.stops).toEqual([sourceSession.externalSessionId]);
    expect(h.resumes).toHaveLength(0);
    expect(h.sends).toHaveLength(mode === "fork" ? 1 : 0);
    if (mode === "fork") expect(h.sends[0]?.externalSessionId).toBe("fork-1");
  },
);

test.each([
  { catalogProviderId: "provider", exactEntry: false },
  { catalogProviderId: "other-provider", exactEntry: false },
  { catalogProviderId: "provider", exactEntry: true },
])(
  "reuse matches the saved Claude provider and prefers an exact model row: %j",
  async ({ catalogProviderId, exactEntry }) => {
    const h = await createLaunchHarness("claude");
    const selectedModel = { ...modelFor("claude"), modelId: "claude-opus-5-5" };
    const source = {
      externalSessionId: "source",
      runtimeKind: "claude" as const,
      workingDirectory: "/worktrees/task",
      role: "build" as const,
      startedAt: timestamp,
      selectedModel,
      speed: "standard",
    };
    h.records.push(source);
    const catalog = await Effect.runPromise(h.queries.loadRuntimeCatalog());
    h.queries.loadRuntimeCatalog = () =>
      Effect.succeed({
        ...catalog,
        models: {
          ...catalog.models,
          catalog: {
            ...catalog.models.catalog,
            models: [
              {
                ...catalog.models.catalog.models[0]!,
                id: `${catalogProviderId}/opus`,
                providerId: catalogProviderId,
                modelId: "opus",
                resolvedModelId: selectedModel.modelId,
                variants: exactEntry ? ["alias-only"] : ["medium"],
              },
              ...(exactEntry
                ? [
                    {
                      ...catalog.models.catalog.models[0]!,
                      id: `${selectedModel.providerId}/${selectedModel.modelId}`,
                      modelId: selectedModel.modelId,
                    },
                  ]
                : []),
            ],
          },
        },
      });
    h.setTaskStatus("in_progress");
    const result = await Effect.runPromise(
      h.service.launch({
        ...requestFor("claude"),
        policy: {
          kind: "manual",
          actionId: "build_after_qa_rejected",
          decision: {
            startMode: "reuse",
            sourceSession: {
              externalSessionId: source.externalSessionId,
              runtimeKind: source.runtimeKind,
              workingDirectory: source.workingDirectory,
            },
          },
        },
      }),
    );
    expect(h.starts).toHaveLength(0);
    if (catalogProviderId === selectedModel.providerId) {
      expect(result.failure).toBeUndefined();
      expect(result.acceptance).toBe("accepted");
      expect(result.session?.externalSessionId).toBe(source.externalSessionId);
      expect(h.records[0]?.selectedModel).toEqual(selectedModel);
      expect(h.resumes).toEqual([source.externalSessionId]);
      expect(h.sends).toHaveLength(1);
      expect(h.sends[0]?.model).toEqual(selectedModel);
    } else {
      expect(result.phase).toBe("failed");
      expect(result.failure?.message).toContain("unavailable");
      expect(h.resumes).toHaveLength(0);
      expect(h.sends).toHaveLength(0);
    }
  },
);

test.each(["opencode", "codex", "claude"] as const)(
  "sends the complete typed task draft after its caller leaves: %s",
  async (runtimeKind) => {
    const h = await createLaunchHarness(runtimeKind);
    const gate = await Effect.runPromise(Deferred.make<void>());
    h.setStoreGate(Deferred.await(gate));
    const request = requestFor(runtimeKind);
    const parts: AgentSessionControlSendInput["parts"] = [
      { kind: "text", text: "Review this " },
      {
        kind: "file_reference",
        file: { id: "file", path: "src/main.ts", name: "main.ts", kind: "code" },
      },
      {
        kind: "attachment",
        attachment: {
          id: "image",
          name: "screen.png",
          path: "/staged/screen.png",
          kind: "image",
          mime: "image/png",
        },
      },
    ];
    request.instruction = { kind: "message", parts };
    await Effect.runPromise(
      Effect.gen(function* () {
        const caller = yield* Effect.forkChild(h.service.launch(request));
        while (h.starts.length === 0) yield* Effect.yieldNow;
        yield* Fiber.interrupt(caller);
        yield* Deferred.succeed(gate, undefined);
        const result = yield* h.service.launch(request);
        expect(result.acceptance).toBe("accepted");
        expect(h.starts).toHaveLength(1);
        expect(h.sends).toHaveLength(1);
        expect(h.sends[0]?.parts).toEqual(parts);
        expect(h.records[0]?.externalSessionId).toBe(result.session?.externalSessionId);
      }),
    );
  },
);

test.each([
  ["finalObservation", "cancel"],
  ["finalObservation", "shutdown"],
  ["finalObservation", "session_stop"],
  ["admissionRelease", "cancel"],
  ["finalPublication", "cancel"],
  ["finalPublication", "session_stop"],
] as const)(
  "%s cancellation through %s settles the exact saved session",
  async (boundary, action) => {
    const entered = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const h = await createLaunchHarness("codex", {
      [boundary]: Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
      ),
    });
    const request = requestFor("codex");
    await Effect.runPromise(
      Effect.gen(function* () {
        const launch = yield* Effect.forkChild(h.service.launch(request));
        yield* Deferred.await(entered);
        const [pending] = yield* h.service.read(request);
        const ref = {
          repoPath: request.repoPath,
          externalSessionId: pending!.session!.externalSessionId,
          runtimeKind: pending!.session!.runtimeKind,
          workingDirectory: pending!.session!.workingDirectory,
        };
        const cancel = yield* Effect.forkChild(
          action === "shutdown"
            ? h.service.shutdown()
            : action === "session_stop"
              ? h.service
                  .cancelSessionBeforeStop(ref)
                  .pipe(Effect.andThen(h.runtime.stopSession(ref)))
              : Effect.all([h.service.cancel(request), h.service.cancel(request)]).pipe(
                  Effect.asVoid,
                ),
        );
        yield* Effect.yieldNow;
        expect(cancel.pollUnsafe()).toBeUndefined();
        expect(h.stops).toHaveLength(0);
        yield* Deferred.succeed(release, undefined);
        const outcome = yield* Fiber.join(launch);
        yield* Fiber.join(cancel);
        expect(outcome).toMatchObject({
          phase: "canceled",
          acceptance: "accepted",
          ownershipSaved: true,
          recoveryAllowed: false,
        });
        expect(h.snapshots.at(-1)?.phase).toBe("canceled");
        expect(h.stops).toEqual([ref.externalSessionId]);
        expect(yield* h.runtime.read(ref)).toMatchObject({ type: "missing" });
        expect(h.records).toHaveLength(1);
        expect(h.sends).toHaveLength(1);
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined))),
    );
  },
);

test.each(["rejected", "stopped"] as const)(
  "cancellation during failed final publication retains failures and the %s native state",
  async (nativeStop) => {
    const entered = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const h = await createLaunchHarness("codex", {
      finalPublication: Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.andThen(Effect.fail(failure("Exact final publication failure"))),
      ),
    });
    h.setStopFailure(nativeStop);
    const request = requestFor("codex");
    await Effect.runPromise(
      Effect.gen(function* () {
        const launch = yield* Effect.forkChild(h.service.launch(request));
        yield* Deferred.await(entered);
        const cancel = yield* Effect.forkChild(h.service.cancel(request));
        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, undefined);
        const outcome = yield* Fiber.join(launch);
        expect(yield* Fiber.join(cancel)).toEqual(outcome);
        expect(outcome).toMatchObject({
          phase: "canceled",
          acceptance: "accepted",
          ownershipSaved: true,
          recoveryAllowed: false,
          failure: {
            message: "Exact final publication failure",
            cleanupErrors: ["Exact stop failure"],
          },
        });
        expect(h.stops).toEqual([outcome.session!.externalSessionId]);
        if (nativeStop === "stopped") expect(outcome.liveSession).toBeUndefined();
        else expect(outcome.liveSession?.activity).toBe("waiting_for_question");
        expect(h.records).toHaveLength(1);
        expect(h.snapshots.at(-1)?.phase).toBe("canceled");
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined))),
    );
  },
);

test.each(["holdRelease", "admissionRelease"] as const)(
  "recovery joins an unfinished failed launch through %s cleanup",
  async (boundary) => {
    const entered = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const h = await createLaunchHarness("codex", {
      [boundary]: Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
      ),
    });
    h.setSendFailure("rejected");
    const request = requestFor("codex");
    await Effect.runPromise(
      Effect.gen(function* () {
        const launch = yield* Effect.forkChild(h.service.launch(request));
        yield* Deferred.await(entered);
        const [pending] = yield* h.service.read(request);
        h.setSendFailure(null);
        const recovery = yield* Effect.forkChild(h.service.recover(request));
        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, undefined);
        const [original, recovered] = yield* Effect.all([
          Fiber.join(launch),
          Fiber.join(recovery),
        ]).pipe(Effect.timeout("500 millis"));
        expect(pending!.recoveryAllowed).toBe(false);
        expect(original.phase).toBe("failed");
        expect(recovered.phase).toBe("completed");
        expect(recovered.session).toEqual(original.session);
        expect(h.starts).toHaveLength(1);
        expect(h.sends).toHaveLength(2);
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined))),
    );
  },
);

test.each(["cancel", "shutdown"] as const)(
  "%s joins failed launch cleanup before stopping the saved session",
  async (action) => {
    const entered = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const h = await createLaunchHarness("codex", {
      holdRelease: Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
      ),
    });
    h.setPublishFailure();
    const request = requestFor("codex");
    await Effect.runPromise(
      Effect.gen(function* () {
        const launch = yield* Effect.forkChild(h.service.launch(request));
        yield* Deferred.await(entered);
        const cancellation = yield* Effect.forkChild(
          action === "cancel"
            ? h.service.cancel(request).pipe(Effect.asVoid)
            : h.service.shutdown(),
        );
        yield* Effect.yieldNow;
        expect(cancellation.pollUnsafe()).toBeUndefined();
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(cancellation);
        const outcome = yield* Fiber.join(launch);
        expect(outcome.phase).toBe("canceled");
        expect(h.stops).toEqual([outcome.session!.externalSessionId]);
        expect(h.sends).toHaveLength(0);
        expect(outcome.recoveryAllowed).toBe(false);
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined))),
    );
  },
);

test.each(["opencode", "codex", "claude"] as const)(
  "fresh %s launch saves ownership and awaits native admission with no browser",
  async (kind) => {
    const h = await createLaunchHarness(kind);
    const request = requestFor(kind);
    const result = await Effect.runPromise(h.service.launch(request));
    expect(result).toMatchObject({
      workspaceId: "workspace",
      repoPath: "/repo",
      taskId: "task",
      phase: "completed",
      acceptance: "accepted",
      ownershipSaved: true,
      liveSession: {
        activity: "waiting_for_question",
        pendingQuestions: [{ requestId: "question" }],
      },
    });
    expect(h.records).toHaveLength(1);
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0]?.parts).toEqual([{ kind: "text", text: "\n  retained instruction\n" }]);
    expect(h.getTask().status).toBe("in_progress");
    expect(h.sends[0]?.systemPrompt).toContain("Task context");
    const state = await Effect.runPromise(
      h.runtime.read({ repoPath: "/repo", ...result.session! }),
    );
    expect(state.type === "live" && state.session.activity).toBe("waiting_for_question");
  },
);

test("caller interruption does not cancel the admitted host worker", async () => {
  const h = await createLaunchHarness();
  await Effect.runPromise(
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      h.setStoreGate(Deferred.await(gate));
      const caller = yield* Effect.forkChild(h.service.launch(requestFor("codex")));
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(caller);
      yield* Deferred.succeed(gate, undefined);
    }),
  );
  // Read the same attempt by joining its retained completion, without another launch.
  const result = await Effect.runPromise(h.service.launch(requestFor("codex")));
  expect(result.acceptance).toBe("accepted");
  expect(h.starts).toHaveLength(1);
  expect(h.sends).toHaveLength(1);
});

test.each(["opencode", "codex", "claude"] as const)(
  "reuse %s resumes the exact saved source without creating a session or reading history",
  async (kind) => {
    const h = await createLaunchHarness(kind);
    h.records.push({
      externalSessionId: "source",
      runtimeKind: kind,
      workingDirectory: "/worktrees/task",
      role: "build",
      startedAt: timestamp,
      selectedModel: modelFor(kind),
    });
    const request: WorkflowLaunchRequest = {
      ...requestFor(kind),
      policy: {
        kind: "manual",
        actionId: "build_after_qa_rejected",
        decision: {
          startMode: "reuse",
          sourceSession: {
            externalSessionId: "source",
            runtimeKind: kind,
            workingDirectory: "/worktrees/task",
          },
        },
      },
    };
    h.setTaskStatus("in_progress");
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const release = yield* Deferred.make<void>();
        return yield* Effect.gen(function* () {
          h.setSendGate(Deferred.await(release));
          const launch = yield* Effect.forkChild(h.service.launch(request));
          yield* Deferred.await(h.sendEntered);
          const ownership = h.envelopes
            .map((event) => agentSessionLiveEnvelopeSchema.parse(event))
            .filter((event) => event.type === "task_session_records_updated");
          expect(ownership).toEqual([
            {
              type: "task_session_records_updated",
              repoPath: "/repo",
              taskId: "task",
              agentSessions: h.records,
              liveSession: expect.objectContaining({
                ref: expect.objectContaining({ externalSessionId: "source", runtimeKind: kind }),
                activity: "idle",
              }),
            },
          ]);
          yield* Deferred.succeed(release, undefined);
          return yield* Fiber.join(launch);
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
      }),
    );
    expect(result.acceptance).toBe("accepted");
    expect(result.session?.externalSessionId).toBe("source");
    expect(h.starts).toHaveLength(0);
    expect(h.resumes).toEqual(["source"]);
    expect(h.sends[0]?.model).toEqual(modelFor(kind));
  },
);

test.each(["rejected", "unknown", "accepted"] as const)(
  "retains session identity and exact send failure with %s acceptance",
  async (acceptance) => {
    const h = await createLaunchHarness();
    h.setSendFailure(acceptance);
    const request = requestFor("codex");
    const result = await Effect.runPromise(h.service.launch(request));
    expect(result).toMatchObject({
      phase: "failed",
      acceptance,
      ownershipSaved: true,
      session: { externalSessionId: "session-1" },
    });
    expect(h.records).toHaveLength(1);
    expect(h.stops).toHaveLength(0);
    h.setSendFailure(null);
    if (acceptance === "unknown")
      await expect(Effect.runPromise(h.service.recover(request))).rejects.toThrow(
        "Inspect the saved session",
      );
    else {
      const results = await Promise.all([
        Effect.runPromise(h.service.recover(request)),
        Effect.runPromise(h.service.recover(request)),
      ]);
      expect(results.every((item) => item.acceptance === "accepted")).toBe(true);
      expect(h.sends).toHaveLength(acceptance === "rejected" ? 2 : 1);
    }
    expect(h.starts).toHaveLength(1);
  },
);

test.each(["codex", "claude", "opencode"] as const)(
  "recovery reattaches a missing %s session and sends only the rejected instruction",
  async (runtimeKind) => {
    const h = await createLaunchHarness(runtimeKind);
    const request = requestFor(runtimeKind);
    h.setSendFailure("rejected");
    const failed = await Effect.runPromise(h.service.launch(request));
    expect(failed).toMatchObject({ phase: "failed", acceptance: "rejected", ownershipSaved: true });
    h.live.clear();
    h.setSendFailure(null);

    const recovered = await Effect.runPromise(h.service.recover(request));

    expect(recovered).toMatchObject({
      phase: "completed",
      acceptance: "accepted",
      session: failed.session,
    });
    expect(h.resumes).toEqual([failed.session!.externalSessionId]);
    expect(h.sends).toHaveLength(2);
    expect(h.sends[1]).toEqual(h.sends[0]);
    expect(h.starts).toHaveLength(1);
    expect(h.records).toHaveLength(1);
    expect(h.stops).toHaveLength(0);
  },
);

test.each(["fresh", "cold_reuse"] as const)(
  "a %s publication failure after ownership commit retains the session and does not clean its worktree",
  async (mode) => {
    const h = await createLaunchHarness();
    const request = requestFor("codex");
    if (mode === "cold_reuse") {
      h.records.push({
        externalSessionId: "source",
        runtimeKind: "codex",
        workingDirectory: "/worktrees/task",
        role: "build",
        startedAt: timestamp,
        selectedModel: modelFor("codex"),
        speed: "standard",
      });
      request.policy = {
        kind: "manual",
        actionId: "build_after_qa_rejected",
        decision: {
          startMode: "reuse",
          sourceSession: {
            externalSessionId: "source",
            runtimeKind: "codex",
            workingDirectory: "/worktrees/task",
          },
        },
      };
      h.setTaskStatus("in_progress");
    }
    h.setPublishFailure();
    const result = await Effect.runPromise(h.service.launch(request));
    expect(result.ownershipSaved).toBe(true);
    expect(result.recoveryAllowed).toBe(false);
    expect(h.records).toHaveLength(1);
    expect(h.stops).toHaveLength(0);
    expect(result.failure?.message).toBe("Ownership publication failed");
    expect(result.failure?.stage).toBe("publication");
    await expect(Effect.runPromise(h.service.recover(request))).rejects.toThrow(
      "recovery is unavailable",
    );
    expect((await Effect.runPromise(h.service.read(request)))[0]).toEqual(result);
    expect(h.sends).toHaveLength(0);
    expect(h.starts).toHaveLength(mode === "fresh" ? 1 : 0);
    expect(h.resumes).toEqual(mode === "fresh" ? [] : ["source"]);
    expect(h.records).toHaveLength(1);
  },
);

test.each(["opencode", "codex", "claude"] as const)(
  "fork %s uses the exact task-owned parent and stores the child before admission",
  async (kind) => {
    const h = await createLaunchHarness(kind);
    h.enablePullRequests();
    h.setTaskStatus("human_review");
    h.records.push({
      externalSessionId: "parent",
      runtimeKind: kind,
      workingDirectory: "/worktrees/task",
      role: "build",
      startedAt: timestamp,
      selectedModel: modelFor(kind),
    });
    const result = await Effect.runPromise(
      h.service.launch({
        ...requestFor(kind),
        policy: {
          kind: "manual",
          actionId: "build_pull_request_generation",
          decision: {
            startMode: "fork",
            sourceSession: {
              externalSessionId: "parent",
              runtimeKind: kind,
              workingDirectory: "/worktrees/task",
            },
            selectedModel: modelFor(kind),
          },
        },
      }),
    );
    expect(result).toMatchObject({
      phase: "completed",
      acceptance: "accepted",
      ownershipSaved: true,
      session: { externalSessionId: "fork-1", workingDirectory: "/worktrees/task" },
    });
    expect(h.forks).toEqual(["parent"]);
    expect(h.starts).toHaveLength(0);
    expect(h.records.map((record) => record.externalSessionId)).toEqual(["parent", "fork-1"]);
    expect(h.sends[0]?.externalSessionId).toBe("fork-1");
  },
);

test("starting state suppresses native idle until admission and preserves pending questions", async () => {
  const h = await createLaunchHarness();
  await Effect.runPromise(
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      h.setSendGate(Deferred.await(gate));
      const worker = yield* Effect.forkChild(h.service.launch(requestFor("codex")));
      yield* Deferred.await(h.sendEntered);
      const result = yield* h.service.read({
        workspaceId: "workspace",
        repoPath: "/repo",
        taskId: "task",
        launchAttemptId: "attempt",
      });
      const ref = { repoPath: "/repo", ...result[0]!.session! };
      const live = yield* h.runtime.read(ref);
      expect(live.type === "live" && live.session.activity).toBe("running");
      const conflict = yield* Effect.exit(
        h.lifecycle.runReservedTaskOperation("/repo", "task", Effect.void),
      );
      expect(conflict._tag).toBe("Failure");
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(worker);
      const settled = yield* h.runtime.read(ref);
      expect(settled.type === "live" && settled.session.activity).toBe("waiting_for_question");
    }),
  );
});

test("explicit cancellation joins in-flight acceptance and stops the exact saved session", async () => {
  const h = await createLaunchHarness();
  await Effect.runPromise(
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      h.setSendGate(Deferred.await(gate));
      const launch = yield* Effect.forkChild(h.service.launch(requestFor("codex")));
      yield* Deferred.await(h.sendEntered);
      const cancel = yield* Effect.forkChild(
        h.service.cancel({
          workspaceId: "workspace",
          repoPath: "/repo",
          taskId: "task",
          launchAttemptId: "attempt",
        }),
      );
      yield* Effect.yieldNow;
      yield* Deferred.succeed(gate, undefined);
      const result = yield* Fiber.join(launch);
      yield* Fiber.join(cancel);
      expect(result).toMatchObject({
        phase: "canceled",
        acceptance: "accepted",
        ownershipSaved: true,
      });
    }),
  );
  expect(h.starts).toHaveLength(1);
  expect(h.sends).toHaveLength(1);
  expect(h.stops).toEqual(["session-1"]);
  expect(h.records).toHaveLength(1);
});

test("the session stop command joins launch admission and owns the single native stop", async () => {
  const h = await createLaunchHarness();
  await Effect.runPromise(
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      h.setSendGate(Deferred.await(gate));
      const request = requestFor("codex");
      const launch = yield* Effect.forkChild(h.service.launch(request));
      yield* Deferred.await(h.sendEntered);
      const [attempt] = yield* h.service.read(request);
      const ref = { repoPath: request.repoPath, ...attempt!.session! };
      const stop = yield* Effect.forkChild(
        h.service.cancelSessionBeforeStop(ref).pipe(Effect.andThen(h.runtime.stopSession(ref))),
      );
      yield* Effect.yieldNow;
      expect(h.stops).toHaveLength(0);
      yield* Deferred.succeed(gate, undefined);
      expect(yield* Fiber.join(launch)).toMatchObject({
        phase: "canceled",
        acceptance: "accepted",
      });
      yield* Fiber.join(stop);
    }),
  );
  expect(h.stops).toEqual(["session-1"]);
  expect(h.records).toHaveLength(1);
  expect(h.sends).toHaveLength(1);
});

test("recovery rejects removed ownership before native resume or another send", async () => {
  const h = await createLaunchHarness();
  h.setSendFailure("rejected");
  const request = requestFor("codex");
  await Effect.runPromise(h.service.launch(request));
  h.records.splice(0);
  h.live.clear();
  const result = await Effect.runPromise(h.service.recover(request));
  expect(result.failure?.message).toContain("no longer owned");
  expect(h.resumes).toHaveLength(0);
  expect(h.sends).toHaveLength(1);
  expect(h.starts).toHaveLength(1);
});

test("an ownership save failure stops the native session before the first send", async () => {
  const h = await createLaunchHarness();
  h.setSaveFailure();
  const result = await Effect.runPromise(h.service.launch(requestFor("codex")));
  expect(result).toMatchObject({
    phase: "failed",
    ownershipSaved: false,
    failure: { message: "Ownership save failed" },
  });
  expect(h.records).toHaveLength(0);
  expect(h.sends).toHaveLength(0);
  expect(h.stops).toEqual(["session-1"]);
});

test("cancellation during a failed ownership save does not repeat native cleanup", async () => {
  const h = await createLaunchHarness();
  h.setSaveFailure();
  await Effect.runPromise(
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      h.setStoreGate(
        Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(gate))),
      );
      const request = requestFor("codex");
      const launch = yield* Effect.forkChild(h.service.launch(request));
      yield* Deferred.await(entered);
      const cancel = yield* Effect.forkChild(h.service.cancel(request));
      yield* Effect.yieldNow;
      yield* Deferred.succeed(gate, undefined);
      expect(yield* Fiber.join(launch)).toMatchObject({
        phase: "canceled",
        ownershipSaved: false,
        failure: { message: "Ownership save failed" },
      });
      yield* Fiber.join(cancel);
    }),
  );
  expect(h.stops).toEqual(["session-1"]);
  expect(h.sends).toHaveLength(0);
  expect(h.records).toHaveLength(0);
});

test("host shutdown joins native submission before stopping and rejects new launches", async () => {
  const h = await createLaunchHarness();
  await Effect.runPromise(
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      h.setSendGate(Deferred.await(gate));
      const launch = yield* Effect.forkChild(h.service.launch(requestFor("codex")));
      yield* Deferred.await(h.sendEntered);
      const shutdown = yield* Effect.forkChild(h.service.shutdown());
      yield* Effect.yieldNow;
      expect(h.stops).toHaveLength(0);
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(shutdown);
      expect((yield* Fiber.join(launch)).phase).toBe("canceled");
    }),
  );
  expect(h.stops).toEqual(["session-1"]);
  await expect(
    Effect.runPromise(h.service.launch(requestFor("codex", "after-shutdown"))),
  ).rejects.toThrow("admission is closed");
});

test.each(["fresh", "fork"] as const)(
  "%s launch saves the requested speed before native submission",
  async (mode) => {
    const h = await createLaunchHarness("codex");
    const request = requestFor("codex");
    if (mode === "fork") {
      h.enablePullRequests();
      h.setTaskStatus("human_review");
      h.records.push({
        externalSessionId: "source",
        runtimeKind: "codex",
        workingDirectory: "/worktrees/task",
        role: "build",
        startedAt: timestamp,
        selectedModel: modelFor("codex"),
        speed: "standard",
      });
      request.policy = {
        kind: "manual",
        actionId: "build_pull_request_generation",
        decision: {
          startMode: "fork",
          sourceSession: h.records[0]!,
          selectedModel: modelFor("codex"),
          speed: "fast",
        },
      };
    } else
      request.policy = {
        kind: "manual",
        actionId: "build_implementation_start",
        decision: { startMode: "fresh", selectedModel: modelFor("codex"), speed: "fast" },
      };
    const outcome = await Effect.runPromise(h.service.launch(request));
    expect(outcome.acceptance).toBe("accepted");
    expect((mode === "fresh" ? h.startInputs : h.forkInputs)[0]?.speed).toBe("fast");
    expect(h.records.at(-1)?.speed).toBe("fast");
    expect(h.sends[0]?.speed).toBe("fast");
  },
);

test.each([undefined, "fast"] as const)(
  "reuse launch applies its saved or requested speed, then retries the current saved choice: %s",
  async (speed) => {
    const h = await createLaunchHarness("codex");
    const source = requestFor("codex", "source");
    if (source.policy.kind === "manual" && speed === undefined)
      source.policy.decision.speed = "fast";
    const created = await Effect.runPromise(
      h.service.launch({ ...source, instruction: { kind: "none" } }),
    );
    const decision: WorkflowLaunchDecision = {
      startMode: "reuse",
      sourceSession: created.session!,
    };
    if (speed !== undefined) decision.speed = speed;
    const request: WorkflowLaunchRequest = {
      ...requestFor("codex", "reuse"),
      policy: {
        kind: "manual",
        actionId: "build_after_qa_rejected",
        decision,
      },
    };
    h.setSendFailure("rejected");
    const failed = await Effect.runPromise(h.service.launch(request));
    expect(failed.recoveryAllowed).toBe(true);
    expect(h.records[0]?.speed).toBe("fast");
    expect(h.sends[0]?.speed).toBe("fast");
    await Effect.runPromise(
      h.commands.updateSessionSpeed({
        repoPath: "/repo",
        ...created.session!,
        sessionScope: { kind: "workflow", taskId: "task", role: "build" },
        speed: "standard",
      }),
    );
    h.setSendFailure(null);
    expect((await Effect.runPromise(h.service.recover(request))).acceptance).toBe("accepted");
    expect(h.sends[1]?.speed).toBe("standard");
    expect(h.starts).toHaveLength(1);
  },
);

test("reuse with an unknown native speed rejects before submission and permits an explicit choice before Retry", async () => {
  const h = await createLaunchHarness("codex");
  const created = await Effect.runPromise(
    h.service.launch({ ...requestFor("codex", "source"), instruction: { kind: "none" } }),
  );
  h.records[0]!.speed = null;
  for (const snapshot of h.live.values())
    snapshot.speed = { ...snapshot.speed!, choice: null, synchronization: "unapplied" };
  const request: WorkflowLaunchRequest = {
    ...requestFor("codex", "reuse"),
    policy: {
      kind: "manual",
      actionId: "build_after_qa_rejected",
      decision: { startMode: "reuse", sourceSession: created.session! },
    },
  };
  const failed = await Effect.runPromise(h.service.launch(request));
  expect(failed).toMatchObject({ acceptance: "rejected", recoveryAllowed: true });
  expect(h.sends).toHaveLength(0);
  expect(h.records[0]?.speed).toBeNull();
  await Effect.runPromise(
    h.commands.updateSessionSpeed({
      repoPath: "/repo",
      ...created.session!,
      sessionScope: { kind: "workflow", taskId: "task", role: "build" },
      speed: "standard",
    }),
  );
  expect((await Effect.runPromise(h.service.recover(request))).acceptance).toBe("accepted");
  expect(h.sends[0]?.speed).toBe("standard");
  expect(h.starts).toHaveLength(1);
});
