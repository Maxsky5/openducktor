import { expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import { agentSessionLiveEnvelopeSchema } from "@openducktor/contracts";
import type {
  AgentSessionControlSendInput,
  AgentSessionLiveRef,
  RuntimeKind,
  WorkflowLaunchRequest,
} from "@openducktor/contracts";
import {
  createLaunchHarness,
  requestFor,
  modelFor,
  timestamp,
  failure,
} from "./test-support/workflow-launch-harness";
import { createNodeSessionLaunchControls } from "../../composition/node/node-session-launch-controls";

const runtimeKinds: RuntimeKind[] = ["opencode", "codex", "claude"];
const createdRef: AgentSessionLiveRef = {
  repoPath: "/repo",
  runtimeKind: "codex",
  workingDirectory: "/worktrees/task",
  externalSessionId: "session-1",
};
const builderScope = { kind: "workflow" as const, taskId: "task", role: "build" as const };

/** Lets forked launches reach their next wait point. */
const yieldToFibers = Effect.gen(function* () {
  for (let index = 0; index < 20; index += 1) yield* Effect.yieldNow;
});

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

const reuseRequest = (
  sourceSession: Omit<AgentSessionLiveRef, "repoPath">,
  parts: AgentSessionControlSendInput["parts"] = [{ kind: "text", text: "Resolve the conflict." }],
): WorkflowLaunchRequest => ({
  ...requestFor("codex"),
  policy: {
    kind: "manual",
    actionId: "build_rebase_conflict_resolution",
    decision: { startMode: "reuse", sourceSession },
  },
  instruction: { kind: "message", parts },
});

test.each(["codex", "claude", "opencode"] as const)(
  "%s publishes saved task ownership before the first native send",
  async (runtimeKind) => {
    const h = await createLaunchHarness(runtimeKind);
    const send = await pausePoint();
    h.setSendGate(Deferred.await(send.release));
    await Effect.runPromise(
      Effect.gen(function* () {
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
        yield* send.open;
        expect((yield* Fiber.join(launch)).status).toBe("completed");
      }).pipe(Effect.ensuring(send.open)),
    );
  },
);

test.each(runtimeKinds)(
  "fresh %s launch saves ownership and sends the first instruction with no browser",
  async (kind) => {
    const h = await createLaunchHarness(kind);
    const result = await Effect.runPromise(h.service.launch(requestFor(kind)));
    expect(result).toEqual({
      workspaceId: "workspace",
      repoPath: "/repo",
      taskId: "task",
      role: "build",
      startMode: "fresh",
      status: "completed",
      model: modelFor(kind),
      session: {
        externalSessionId: "session-1",
        runtimeKind: kind,
        workingDirectory: "/worktrees/task",
        startedAt: timestamp,
        status: "idle",
      },
      acceptedMessage: expect.objectContaining({
        externalSessionId: "session-1",
        messageId: "message-1",
      }),
    });
    expect(h.records).toHaveLength(1);
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0]).toMatchObject({
      externalSessionId: "session-1",
      model: modelFor(kind),
      parts: [{ kind: "text", text: "\n  first instruction\n" }],
      sessionScope: builderScope,
    });
    expect(h.sends[0]?.systemPrompt).toContain("Task context");
    expect(h.getTask().status).toBe("in_progress");
    const state = await Effect.runPromise(
      h.runtime.read({ repoPath: "/repo", ...result.session! }),
    );
    expect(state.type === "live" && state.session.activity).toBe("waiting_for_question");
  },
);

test("Resolve conflicts with Reuse existing sends the message to the live Builder session", async () => {
  const h = await createLaunchHarness();
  h.setTaskStatus("in_progress");
  const sourceSession = h.addTaskSession("builder", { live: true });
  const parts: AgentSessionControlSendInput["parts"] = [
    { kind: "text", text: "Resolve the rebase conflict in " },
    {
      kind: "file_reference",
      file: { id: "file", path: "src/main.ts", name: "main.ts", kind: "code" },
    },
  ];
  const result = await Effect.runPromise(h.service.launch(reuseRequest(sourceSession, parts)));
  expect(result).toMatchObject({
    status: "completed",
    role: "build",
    startMode: "reuse",
    model: modelFor("codex"),
    session: { externalSessionId: "builder", workingDirectory: "/worktrees/task" },
    acceptedMessage: { externalSessionId: "builder" },
  });
  expect(result.failure).toBeUndefined();
  expect(h.starts).toEqual([]);
  expect(h.forks).toEqual([]);
  expect(h.resumes).toEqual([]);
  expect(h.sends).toHaveLength(1);
  expect(h.sends[0]).toMatchObject({
    externalSessionId: "builder",
    workingDirectory: "/worktrees/task",
    model: modelFor("codex"),
    parts,
    sessionScope: builderScope,
  });
  expect(h.records.map((record) => record.externalSessionId)).toEqual(["builder"]);
});

test.each(runtimeKinds)(
  "reuse %s resumes the saved source without creating a session",
  async (kind) => {
    const h = await createLaunchHarness(kind);
    h.setTaskStatus("in_progress");
    const sourceSession = h.addTaskSession("source");
    const result = await Effect.runPromise(
      h.service.launch({
        ...requestFor(kind),
        policy: {
          kind: "manual",
          actionId: "build_after_qa_rejected",
          decision: { startMode: "reuse", sourceSession },
        },
      }),
    );
    expect(result).toMatchObject({
      status: "completed",
      startMode: "reuse",
      session: { externalSessionId: "source" },
      acceptedMessage: { externalSessionId: "source" },
    });
    expect(h.starts).toHaveLength(0);
    expect(h.resumes).toEqual(["source"]);
    expect(h.sends[0]?.model).toEqual(modelFor(kind));
  },
);

test.each([
  { speed: "fast", saved: { ...modelFor("claude"), speed: "fast" } },
  { speed: null, saved: modelFor("claude") },
])("reuse saves speed $speed before its kickoff turn", async ({ speed, saved }) => {
  const h = await createLaunchHarness("claude");
  h.setTaskStatus("in_progress");
  const sourceSession = h.addTaskSession("source", {
    selectedModel: speed ? modelFor("claude") : { ...modelFor("claude"), speed: "fast" },
  });
  const result = await Effect.runPromise(
    h.service.launch({
      ...requestFor("claude"),
      policy: {
        kind: "manual",
        actionId: "build_after_qa_rejected",
        decision: { startMode: "reuse", sourceSession, speed },
      },
    }),
  );
  expect(result.status).toBe("completed");
  expect(h.records[0]?.selectedModel).toEqual(saved);
  expect(h.sends[0]?.model).toEqual(saved);
});

test.each(runtimeKinds)(
  "fork %s uses the task-owned parent and saves the child before the first send",
  async (kind) => {
    const h = await createLaunchHarness(kind);
    h.enablePullRequests();
    h.setTaskStatus("human_review");
    const sourceSession = h.addTaskSession("parent");
    const result = await Effect.runPromise(
      h.service.launch({
        ...requestFor(kind),
        policy: {
          kind: "manual",
          actionId: "build_pull_request_generation",
          decision: { startMode: "fork", sourceSession, selectedModel: modelFor(kind) },
        },
      }),
    );
    expect(result).toMatchObject({
      status: "completed",
      startMode: "fork",
      session: { externalSessionId: "fork-1", workingDirectory: "/worktrees/task" },
      acceptedMessage: { externalSessionId: "fork-1" },
    });
    expect(h.forks).toEqual(["parent"]);
    expect(h.starts).toHaveLength(0);
    expect(h.records.map((record) => record.externalSessionId)).toEqual(["parent", "fork-1"]);
    expect(h.sends.map((input) => input.externalSessionId)).toEqual(["fork-1"]);
  },
);

test("manual reuse loads no runtime catalog and keeps a stored model that the catalog does not list", async () => {
  const h = await createLaunchHarness();
  h.setTaskStatus("in_progress");
  const retired = { ...modelFor("codex"), modelId: "retired-model", variant: "retired" };
  const sourceSession = h.addTaskSession("builder", { live: true, selectedModel: retired });
  const result = await Effect.runPromise(h.service.launch(reuseRequest(sourceSession)));
  expect(result).toMatchObject({ status: "completed", model: retired });
  expect(h.catalogLoads()).toBe(0);
  expect(h.sends.map((input) => input.model)).toEqual([retired]);
});

test("a reuse launch refuses a source session that waits for blocking input", async () => {
  const h = await createLaunchHarness();
  h.setTaskStatus("human_review");
  const sourceSession = h.addTaskSession("builder", {
    live: true,
    pendingQuestion: { blocking: true },
  });
  const result = await Effect.runPromise(
    h.service.launch({
      ...reuseRequest(sourceSession),
      policy: {
        kind: "manual",
        actionId: "build_after_human_request_changes",
        decision: { startMode: "reuse", sourceSession },
      },
      instruction: { kind: "kickoff", feedback: "Rename the helper." },
      beforeStartAction: { action: "human_request_changes", note: "Rename the helper." },
    }),
  );
  expect(result).toMatchObject({
    status: "failed",
    failure: { message: expect.stringContaining("waiting for an approval or question") },
  });
  expect(result.session).toBeUndefined();
  expect(h.getTask().status).toBe("human_review");
  expect(h.sends).toEqual([]);
});

test("a reuse launch answers open background questions with its first message", async () => {
  const h = await createLaunchHarness();
  h.setTaskStatus("in_progress");
  const sourceSession = h.addTaskSession("builder", {
    live: true,
    pendingQuestion: { blocking: false },
  });
  const result = await Effect.runPromise(h.service.launch(reuseRequest(sourceSession)));
  expect(result.status).toBe("completed");
  expect(h.sends).toHaveLength(1);
  expect(h.sends[0]?.resolvedQuestionRequestIds).toEqual(["open-question"]);
});

test("a second manual launch for the same task waits for the first and both complete", async () => {
  const h = await createLaunchHarness();
  h.setQuestionAfterSend(false);
  const send = await pausePoint();
  h.setSendGate(Deferred.await(send.release));
  const conflictParts: AgentSessionControlSendInput["parts"] = [
    { kind: "text", text: "Resolve the conflict." },
  ];
  await Effect.runPromise(
    Effect.gen(function* () {
      const first = yield* Effect.forkChild(h.service.launch(requestFor("codex")));
      yield* Deferred.await(h.sendEntered);
      const second = yield* Effect.forkChild(
        h.service.launch(
          reuseRequest(
            {
              externalSessionId: "session-1",
              runtimeKind: "codex",
              workingDirectory: "/worktrees/task",
            },
            conflictParts,
          ),
        ),
      );
      yield* yieldToFibers;
      expect(second.pollUnsafe()).toBeUndefined();
      expect(h.sends).toHaveLength(1);
      yield* send.open;
      expect(yield* Fiber.join(first)).toMatchObject({ status: "completed", startMode: "fresh" });
      expect(yield* Fiber.join(second)).toMatchObject({
        status: "completed",
        startMode: "reuse",
        session: { externalSessionId: "session-1" },
      });
    }).pipe(Effect.ensuring(send.open)),
  );
  expect(h.starts).toEqual(["session-1"]);
  expect(h.sends.map((input) => [input.externalSessionId, input.parts])).toEqual([
    ["session-1", [{ kind: "text", text: "\n  first instruction\n" }]],
    ["session-1", conflictParts],
  ]);
});

test("automatic actions for one task wait for the prior launch to finish", async () => {
  const h = await createLaunchHarness();
  const send = await pausePoint();
  h.setSendGate(Deferred.await(send.release));
  await Effect.runPromise(
    Effect.gen(function* () {
      const planner = yield* Effect.forkChild(
        h.service.launch({
          ...requestFor("codex"),
          policy: { kind: "automatic", actionId: "startPlanner" },
        }),
      );
      yield* Deferred.await(h.sendEntered);
      const builder = yield* Effect.forkChild(
        h.service.launch({
          ...requestFor("codex"),
          policy: { kind: "automatic", actionId: "startBuilder" },
        }),
      );
      yield* yieldToFibers;
      expect(h.starts).toEqual(["session-1"]);
      yield* send.open;
      expect(yield* Fiber.join(planner)).toMatchObject({ status: "completed", role: "planner" });
      expect(yield* Fiber.join(builder)).toMatchObject({ status: "completed", role: "build" });
    }).pipe(Effect.ensuring(send.open)),
  );
  expect(h.records.map((record) => record.role)).toEqual(["planner", "build"]);
  expect(h.sends.map((input) => input.externalSessionId)).toEqual(["session-1", "session-2"]);
  expect(h.getTask().status).toBe("in_progress");
});

test.each(["before its first native send", "after native acceptance"] as const)(
  "task lifecycle work for the same task is not rejected while a launch waits %s",
  async (point) => {
    const wait = await pausePoint();
    const h = await createLaunchHarness(
      "codex",
      point === "after native acceptance" ? { holdRelease: wait.pause } : {},
    );
    if (point === "before its first native send") h.setPublicationGate(wait.pause);
    const other = h.addTaskSession("other", { live: true });
    await Effect.runPromise(
      Effect.gen(function* () {
        const launch = yield* Effect.forkChild(h.service.launch(requestFor("codex")));
        yield* Deferred.await(wait.entered);
        expect(h.sends).toHaveLength(point === "after native acceptance" ? 1 : 0);
        yield* Effect.scoped(
          h.lifecycle.acquireLifecycle("/repo", ["task"], "run a task lifecycle operation"),
        );
        const accepted = yield* h.commands.sendUserMessage({
          repoPath: "/repo",
          ...other,
          sessionScope: builderScope,
          parts: [{ kind: "text", text: "Message for another Builder session" }],
        });
        expect(accepted.externalSessionId).toBe("other");
        yield* wait.open;
        expect((yield* Fiber.join(launch)).status).toBe("completed");
      }).pipe(Effect.ensuring(wait.open)),
    );
    expect(h.sends.map((input) => input.externalSessionId).sort()).toEqual(["other", "session-1"]);
  },
);

test.each(["kickoff", "message"] as const)(
  "a rejected first send returns the saved session and the unsent %s instruction",
  async (instruction) => {
    const h = await createLaunchHarness();
    h.setSendFailure("rejected");
    const parts: AgentSessionControlSendInput["parts"] = [
      { kind: "text", text: "Review " },
      {
        kind: "file_reference",
        file: { id: "file", path: "src/main.ts", name: "main.ts", kind: "code" },
      },
    ];
    const request: WorkflowLaunchRequest =
      instruction === "kickoff"
        ? requestFor("codex")
        : { ...requestFor("codex"), instruction: { kind: "message", parts } };
    const result = await Effect.runPromise(h.service.launch(request));
    expect(result).toMatchObject({
      status: "failed",
      session: { externalSessionId: "session-1" },
      failure: { message: "The model is not available.", cleanupErrors: [] },
    });
    expect(result.unsentInstruction).toEqual(
      instruction === "kickoff" ? [{ kind: "text", text: "\n  first instruction\n" }] : parts,
    );
    expect(result.acceptedMessage).toBeUndefined();
    expect(h.records).toHaveLength(1);
    expect(h.sends).toHaveLength(1);
    expect(h.stops).toEqual([]);
  },
);

test("a first send without an answer returns no instruction and asks the user to inspect the session", async () => {
  const h = await createLaunchHarness();
  h.setSendFailure("uncertain");
  const result = await Effect.runPromise(h.service.launch(requestFor("codex")));
  expect(result).toMatchObject({
    status: "failed",
    session: { externalSessionId: "session-1" },
    failure: {
      message:
        "Native connection lost. The runtime can have received the first instruction. Inspect the session before you send it again.",
      cleanupErrors: [],
    },
  });
  expect(result.unsentInstruction).toBeUndefined();
  expect(result.acceptedMessage).toBeUndefined();
  expect(h.sends).toHaveLength(1);
});

test("the first send reaches the runtime adapter with its native admission options", async () => {
  const h = await createLaunchHarness();
  const result = await Effect.runPromise(h.service.launch(requestFor("codex")));
  expect(result.status).toBe("completed");
  expect(h.sendOptions).toEqual([{ requireNativeAdmission: true, onSent: expect.any(Function) }]);
});

test("a browser that attaches after the caller left sees the launch failure in the session", async () => {
  const h = await createLaunchHarness();
  const send = await pausePoint();
  h.setSendGate(Deferred.await(send.release));
  h.setSendFailure("uncertain");
  const failures = () =>
    h.envelopes
      .map((event) => agentSessionLiveEnvelopeSchema.parse(event))
      .flatMap((envelope) =>
        envelope.type === "session_upsert" && envelope.session.launchFailure
          ? [{ ref: envelope.session.ref, launchFailure: envelope.session.launchFailure }]
          : [],
      );
  await Effect.runPromise(
    Effect.gen(function* () {
      const caller = yield* Effect.forkChild(h.service.launch(requestFor("codex")));
      yield* Deferred.await(h.sendEntered);
      // The browser closes. The host worker still settles the launch.
      yield* Fiber.interrupt(caller);
      yield* Deferred.succeed(send.release, undefined);
      for (let attempt = 0; attempt < 100 && failures().length === 0; attempt += 1)
        yield* Effect.sleep(1);
    }),
  );
  const [failure] = failures();
  if (!failure) throw new Error("Expected the launch failure in the session.");
  expect(failure.launchFailure.message).toBe(
    "The session launch failed: Native connection lost. The runtime can have received the first instruction. Inspect the session before you send it again.",
  );
  // The failure is host state. It must not end the runtime turn in the transcript.
  expect(
    h.envelopes
      .map((event) => agentSessionLiveEnvelopeSchema.parse(event))
      .filter(
        (envelope) =>
          envelope.type === "transcript_event" &&
          (envelope.event.type === "turn_error" || envelope.event.type === "session_error"),
      ),
  ).toEqual([]);
  const published = h.envelopes.length;

  await Effect.runPromise(h.runtime.refresh({ repoPath: failure.ref.repoPath }));
  const attached = h.envelopes
    .slice(published)
    .map((event) => agentSessionLiveEnvelopeSchema.parse(event))
    .find((envelope) => envelope.type === "snapshot");
  if (attached?.type !== "snapshot") throw new Error("Expected a fresh snapshot.");
  expect(attached.sessions).toContainEqual(
    expect.objectContaining({ ref: failure.ref, launchFailure: failure.launchFailure }),
  );
});

test("an accepted first send that fails afterwards returns the accepted message and no unsent instruction", async () => {
  const h = await createLaunchHarness();
  h.setSendFailure("accepted");
  const result = await Effect.runPromise(h.service.launch(requestFor("codex")));
  expect(result).toMatchObject({
    status: "failed",
    session: { externalSessionId: "session-1" },
    acceptedMessage: { externalSessionId: "session-1", messageId: "message-1" },
    failure: { message: expect.stringContaining("Exact publication failure") },
  });
  expect(result.unsentInstruction).toBeUndefined();
  expect(h.sends).toHaveLength(1);
  expect(h.stops).toEqual([]);
});

test("canceling a reuse target cancels its queued launch without a send or a stop", async () => {
  const h = await createLaunchHarness();
  const sourceSession = h.addTaskSession("builder", { live: true });
  const send = await pausePoint();
  h.setSendGate(Deferred.await(send.release));
  await Effect.runPromise(
    Effect.gen(function* () {
      const first = yield* Effect.forkChild(h.service.launch(requestFor("codex")));
      yield* Deferred.await(h.sendEntered);
      const queued = yield* Effect.forkChild(h.service.launch(reuseRequest(sourceSession)));
      yield* yieldToFibers;
      h.service.cancelSessionLaunches({ repoPath: "/repo", ...sourceSession });
      yield* send.open;
      expect((yield* Fiber.join(first)).status).toBe("completed");
      const canceled = yield* Fiber.join(queued);
      expect(canceled).toMatchObject({
        status: "canceled",
        failure: { message: "Session launch was canceled.", cleanupErrors: [] },
      });
      expect(canceled.session).toBeUndefined();
      expect(canceled.unsentInstruction).toBeUndefined();
    }).pipe(Effect.ensuring(send.open)),
  );
  expect(h.sends.map((input) => input.externalSessionId)).toEqual(["session-1"]);
  expect(h.stops).toEqual([]);
  expect(h.resumes).toEqual([]);
});

test("a canceled reuse launch does not stop the reused session", async () => {
  const h = await createLaunchHarness();
  h.setTaskStatus("in_progress");
  const sourceSession = h.addTaskSession("builder", { live: true });
  const send = await pausePoint();
  h.setSendGate(Deferred.await(send.release));
  await Effect.runPromise(
    Effect.gen(function* () {
      const launch = yield* Effect.forkChild(h.service.launch(reuseRequest(sourceSession)));
      yield* Deferred.await(h.sendEntered);
      // Shutdown interrupts the pending send. It must not wait for the runtime to answer.
      yield* h.service.shutdown();
      const result = yield* Fiber.join(launch);
      expect(result).toMatchObject({
        status: "canceled",
        session: { externalSessionId: "builder" },
      });
      expect(result.acceptedMessage).toBeUndefined();
    }).pipe(Effect.ensuring(send.open)),
  );
  expect(h.stops).toEqual([]);
  const state = await Effect.runPromise(h.runtime.read({ repoPath: "/repo", ...sourceSession }));
  expect(state.type).toBe("live");
});

test.each(["before", "during"] as const)(
  "Stop %s the first send cancels a fresh launch and stops its session",
  async (point) => {
    const h = await createLaunchHarness();
    const wait = await pausePoint();
    if (point === "before") h.setPublicationGate(wait.pause);
    else h.setSendGate(wait.pause);
    const { commands } = createNodeSessionLaunchControls(h.runtime, [h.service]);
    await Effect.runPromise(
      Effect.gen(function* () {
        const launch = yield* Effect.forkChild(h.service.launch(requestFor("codex")));
        yield* Deferred.await(wait.entered);
        yield* commands.stopSession(createdRef);
        yield* wait.open;
        const result = yield* Fiber.join(launch);
        expect(result).toMatchObject({
          status: "canceled",
          session: { externalSessionId: "session-1" },
        });
        if (point === "before") {
          expect(result.failure?.message).toBe("Session launch was canceled.");
          expect(result.acceptedMessage).toBeUndefined();
        } else expect(result.acceptedMessage?.externalSessionId).toBe("session-1");
        expect(result.unsentInstruction).toBeUndefined();
      }).pipe(Effect.ensuring(wait.open)),
    );
    expect(h.sends).toHaveLength(point === "before" ? 0 : 1);
    // After an accepted send, settlement stops again: the Stop can come before the turn starts.
    expect(h.stops).toEqual(point === "before" ? ["session-1"] : ["session-1", "session-1"]);
    expect(h.records).toHaveLength(1);
  },
);

test("shutdown interrupts a pending first send, stops its session, and rejects new launches", async () => {
  const h = await createLaunchHarness();
  const send = await pausePoint();
  h.setSendGate(Deferred.await(send.release));
  await Effect.runPromise(
    Effect.gen(function* () {
      const launch = yield* Effect.forkChild(h.service.launch(requestFor("codex")));
      yield* Deferred.await(h.sendEntered);
      // Shutdown returns only after the worker settled and stopped the session it created.
      yield* h.service.shutdown();
      expect(h.stops).toEqual(["session-1"]);
      const rejected = yield* Effect.result(h.service.launch(requestFor("codex")));
      expect(rejected._tag).toBe("Failure");
      if (rejected._tag === "Failure")
        expect(rejected.failure.message).toContain("does not accept new session launches");
      const result = yield* Fiber.join(launch);
      expect(result).toMatchObject({
        status: "canceled",
        session: { externalSessionId: "session-1" },
      });
      expect(result.acceptedMessage).toBeUndefined();
      expect(result.unsentInstruction).toBeUndefined();
    }).pipe(Effect.ensuring(send.open)),
  );
  expect(h.starts).toEqual(["session-1"]);
  expect(h.stops).toEqual(["session-1"]);
});

test("a task start completion failure after save publishes the saved record and stops the session", async () => {
  const h = await createLaunchHarness("codex", {
    completion: Effect.fail(failure("Task transition failed")),
  });
  const result = await Effect.runPromise(h.service.launch(requestFor("codex")));
  expect(result).toMatchObject({
    status: "failed",
    session: { externalSessionId: "session-1" },
    failure: { message: "Task transition failed" },
  });
  expect(result.unsentInstruction).toBeUndefined();
  expect(h.publications).toEqual(["agent-session-create"]);
  expect(h.records.map((record) => record.externalSessionId)).toEqual(["session-1"]);
  expect(h.stops).toEqual(["session-1"]);
  expect(h.sends).toEqual([]);
  expect(h.getTask().status).toBe("ready_for_dev");
});

test.each(runtimeKinds)(
  "sends the complete typed task draft after its caller leaves: %s",
  async (runtimeKind) => {
    const h = await createLaunchHarness(runtimeKind);
    const store = await pausePoint();
    h.setStoreGate(Deferred.await(store.release));
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
    const ref = { ...createdRef, runtimeKind };
    await Effect.runPromise(
      Effect.gen(function* () {
        const caller = yield* Effect.forkChild(
          h.service.launch({ ...requestFor(runtimeKind), instruction: { kind: "message", parts } }),
        );
        while (h.starts.length === 0) yield* Effect.yieldNow;
        yield* Fiber.interrupt(caller);
        yield* store.open;
        // The hold ends when the detached launch settles.
        while ((yield* h.runtime.read(ref)).type !== "live") yield* Effect.yieldNow;
        while (true) {
          const state = yield* h.runtime.read(ref);
          if (state.type === "live" && state.session.activity === "waiting_for_question") break;
          yield* Effect.yieldNow;
        }
      }).pipe(Effect.ensuring(store.open)),
    );
    expect(h.starts).toHaveLength(1);
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0]?.parts).toEqual(parts);
    expect(h.records.map((record) => record.externalSessionId)).toEqual(["session-1"]);
  },
);

test("a publication failure after ownership save returns the saved session without a send", async () => {
  const h = await createLaunchHarness();
  h.setPublishFailure();
  const result = await Effect.runPromise(h.service.launch(requestFor("codex")));
  expect(result).toMatchObject({
    status: "failed",
    session: { externalSessionId: "session-1" },
    failure: { message: "Ownership publication failed" },
  });
  expect(result.unsentInstruction).toBeUndefined();
  expect(h.records).toHaveLength(1);
  expect(h.stops).toHaveLength(0);
  expect(h.sends).toHaveLength(0);
  expect(h.removedWorktrees).toEqual([]);
});

test("the launch hold shows a running session until the launch settles", async () => {
  const h = await createLaunchHarness();
  const send = await pausePoint();
  h.setSendGate(Deferred.await(send.release));
  await Effect.runPromise(
    Effect.gen(function* () {
      const launch = yield* Effect.forkChild(h.service.launch(requestFor("codex")));
      yield* Deferred.await(h.sendEntered);
      const held = yield* h.runtime.read(createdRef);
      expect(held.type === "live" && held.session.activity).toBe("running");
      yield* send.open;
      expect((yield* Fiber.join(launch)).status).toBe("completed");
      const settled = yield* h.runtime.read(createdRef);
      expect(settled.type === "live" && settled.session.activity).toBe("waiting_for_question");
    }).pipe(Effect.ensuring(send.open)),
  );
});

test("an ownership save failure stops the native session before the first send", async () => {
  const h = await createLaunchHarness();
  h.setSaveFailure();
  const result = await Effect.runPromise(h.service.launch(requestFor("codex")));
  expect(result).toMatchObject({
    status: "failed",
    failure: { message: "Ownership save failed" },
  });
  expect(result.session).toBeUndefined();
  expect(result.unsentInstruction).toBeUndefined();
  expect(h.records).toHaveLength(0);
  expect(h.sends).toHaveLength(0);
  expect(h.stops).toEqual(["session-1"]);
});

test("shutdown during a failed ownership save stops the native session once", async () => {
  const h = await createLaunchHarness();
  h.setSaveFailure();
  const store = await pausePoint();
  h.setStoreGate(store.pause);
  await Effect.runPromise(
    Effect.gen(function* () {
      const launch = yield* Effect.forkChild(h.service.launch(requestFor("codex")));
      yield* Deferred.await(store.entered);
      // The ownership save cannot be interrupted, so shutdown waits for it.
      const shutdown = yield* Effect.forkChild(h.service.shutdown());
      yield* yieldToFibers;
      expect(shutdown.pollUnsafe()).toBeUndefined();
      yield* store.open;
      yield* Fiber.join(shutdown);
      const result = yield* Fiber.join(launch);
      expect(result.status).toBe("canceled");
      expect(result.session).toBeUndefined();
    }).pipe(Effect.ensuring(store.open)),
  );
  expect(h.stops).toEqual(["session-1"]);
  expect(h.sends).toHaveLength(0);
  expect(h.records).toHaveLength(0);
});
