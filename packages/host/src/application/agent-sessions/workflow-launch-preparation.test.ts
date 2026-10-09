import { expect, spyOn, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import type {
  AgentSessionModelSelection,
  AgentSessionRecord,
  WorkflowLaunchRequest,
} from "@openducktor/contracts";
import { agentSessionRefKey, initialSpeedState } from "@openducktor/core";
import {
  createClaudeQueryFixture,
  createClaudeSession,
  ignoreClaudeBackgroundFailure,
} from "../../adapters/claude/claude-agent-sdk-session-io.test-support";
import type { ClaudeSession } from "../../adapters/claude/claude-agent-sdk-types";
import { ClaudeSessionSpeedControl } from "../../adapters/claude/claude-session-speed-control";
import { toHostOperationError } from "../../effect/host-errors";
import {
  createLaunchHarness,
  requestFor,
  modelFor,
  timestamp,
} from "./test-support/workflow-launch-harness";

test("invalid workspace, task, model, and explicit target fail before native session creation", async () => {
  for (const patch of [
    { workspaceId: "unknown" },
    { repoPath: "/other" },
    { taskId: "missing" },
    { targetWorkingDirectory: "/repo" },
  ]) {
    const h = await createLaunchHarness();
    const result = await Effect.runPromise(h.service.launch({ ...requestFor("codex"), ...patch }));
    expect(result.phase).toBe("failed");
    expect(result.failure?.message).toBeTruthy();
    expect(h.starts).toHaveLength(0);
    expect(h.sends).toHaveLength(0);
  }
  const h = await createLaunchHarness();
  const request = requestFor("codex");
  request.policy = {
    kind: "manual",
    actionId: "build_implementation_start",
    decision: {
      startMode: "fresh",
      selectedModel: { ...modelFor("codex"), modelId: "unavailable" },
    },
  };
  expect((await Effect.runPromise(h.service.launch(request))).failure?.message).toContain(
    "unavailable",
  );
  expect(h.starts).toHaveLength(0);
});

test.each(["fresh", "fork", "reuse"] as const)(
  "%s rejects unsupported speed before task changes and native session creation",
  async (startMode) => {
    const runtimeKind = startMode === "reuse" ? "claude" : "codex";
    const h = await createLaunchHarness(runtimeKind);
    h.setTaskStatus("human_review");
    const task = h.getTask();
    const request = requestFor(runtimeKind);
    request.targetBranch = { remote: "origin", branch: "review" };
    request.instruction = { kind: "kickoff", feedback: "Required changes" };
    if (startMode === "fresh") {
      request.policy = {
        kind: "manual",
        actionId: "build_after_human_request_changes",
        decision: { startMode, selectedModel: modelFor("codex"), speed: "ultrafast" },
      };
      request.beforeStartAction = { action: "human_request_changes", note: "Required changes" };
    } else {
      const source: AgentSessionRecord = {
        externalSessionId: "source",
        runtimeKind,
        workingDirectory: "/worktrees/task",
        role: "build",
        startedAt: timestamp,
        selectedModel: modelFor(runtimeKind),
        speed: "standard",
      };
      h.records.push(source);
      if (startMode === "reuse") {
        configureNativeClaudeSpeed(h);
        request.policy = {
          kind: "manual",
          actionId: "build_after_human_request_changes",
          decision: { startMode, sourceSession: source, speed: "ultrafast" },
        };
        request.beforeStartAction = { action: "human_request_changes", note: "Required changes" };
      } else {
        h.enablePullRequests();
        request.policy = {
          kind: "manual",
          actionId: "build_pull_request_generation",
          decision: {
            startMode,
            sourceSession: source,
            selectedModel: modelFor("codex"),
            speed: "ultrafast",
          },
        };
      }
    }
    const result = await Effect.runPromise(h.service.launch(request));
    expect(result.phase).toBe("failed");
    expect(result.failure?.message).toContain(
      startMode === "reuse" ? "does not support this speed level" : "ultrafast",
    );
    expect(result.completedPreStartActions).toEqual([]);
    expect(h.getTask()).toEqual(task);
    expect(h.starts).toHaveLength(0);
    expect(h.forks).toHaveLength(0);
    expect(h.sends).toHaveLength(0);
  },
);

test("explicit cold reuse checks the native model and retains it for submission", async () => {
  const h = await createLaunchHarness("claude");
  const source: AgentSessionRecord = {
    externalSessionId: "source",
    runtimeKind: "claude",
    workingDirectory: "/worktrees/task",
    role: "build",
    startedAt: timestamp,
    selectedModel: modelFor("claude"),
    speed: "standard",
  };
  h.records.push(source);
  const nativeModel = { ...modelFor("claude"), modelId: "native-model" };
  configureNativeClaudeSpeed(h, nativeModel);
  const catalog = await Effect.runPromise(h.queries.loadRuntimeCatalog());
  const entry = catalog.models.catalog.models[0]!;
  h.queries.loadRuntimeCatalog = () =>
    Effect.succeed({
      ...catalog,
      models: {
        ...catalog.models,
        catalog: {
          ...catalog.models.catalog,
          models: [
            { ...entry, speedLevels: [{ id: "standard", label: "Standard" }] },
            { ...entry, id: "provider/native-model", modelId: nativeModel.modelId },
          ],
        },
      },
    });
  h.setTaskStatus("human_review");
  const result = await Effect.runPromise(
    h.service.launch({
      ...requestFor("claude"),
      policy: {
        kind: "manual",
        actionId: "build_after_human_request_changes",
        decision: { startMode: "reuse", sourceSession: source, speed: "fast" },
      },
      beforeStartAction: { action: "human_request_changes", note: "Required changes" },
      instruction: { kind: "kickoff", feedback: "Required changes" },
      targetBranch: { remote: "origin", branch: "review" },
    }),
  );
  expect(result.failure).toBeUndefined();
  expect(result.phase).toBe("completed");
  expect(result.completedPreStartActions).toEqual(["human_request_changes", "target_branch"]);
  expect(h.getTask()).toMatchObject({
    status: "in_progress",
    targetBranch: { remote: "origin", branch: "review" },
  });
  expect(h.records[0]).toMatchObject({ selectedModel: nativeModel, speed: "fast" });
  expect(h.sends).toHaveLength(1);
  expect(h.sends[0]).toMatchObject({ model: nativeModel, speed: "fast" });
});

const configureNativeClaudeSpeed = (
  h: Awaited<ReturnType<typeof createLaunchHarness>>,
  nativeModel: AgentSessionModelSelection = modelFor("claude"),
) => {
  let session: ClaudeSession | undefined;
  const control = new ClaudeSessionSpeedControl({
    findSession: () => session,
    requireSession: () => {
      if (!session) throw new Error("Session not attached");
      return session;
    },
    createSession: (input) =>
      Effect.sync(() => {
        session = createClaudeSession({
          input,
          externalSessionId: "source",
          model: nativeModel,
          query: createClaudeQueryFixture({
            supportedModels: async () => [
              {
                value: "model",
                displayName: "Model",
                description: "Model",
                supportsFastMode: false,
              },
              {
                value: "native-model",
                displayName: "Native model",
                description: "Native model",
                supportsFastMode: true,
              },
            ],
          }),
        });
        const ref = {
          repoPath: input.repoPath,
          runtimeKind: "claude" as const,
          workingDirectory: input.workingDirectory,
          externalSessionId: "source",
        };
        h.live.set(agentSessionRefKey(ref), {
          ref,
          activity: "idle",
          title: "Native",
          model: nativeModel,
          speed: initialSpeedState("standard", "confirmed"),
          startedAt: timestamp,
          pendingApprovals: [],
          pendingQuestions: [],
          contextUsage: null,
        });
        return session.summary;
      }),
    now: () => timestamp,
    emit: () => {},
    onBackgroundFailure: ignoreClaudeBackgroundFailure,
  });
  const setSpeedState = h.adapter.setSessionSpeedState;
  spyOn(h.adapter, "holdSessionTurns").mockImplementation((input) =>
    control.holdSessionTurns(input, "runtime"),
  );
  spyOn(h.adapter, "updateSessionSpeed").mockImplementation((input, retained) =>
    control
      .updateSessionSpeed(input, retained)
      .pipe(Effect.mapError((cause) => toHostOperationError(cause, "test.native-speed"))),
  );
  spyOn(h.adapter, "setSessionSpeedState").mockImplementation((input, speed) =>
    control.setSessionSpeedState(input, speed).pipe(Effect.andThen(setSpeedState(input, speed))),
  );
};

test("automatic launch validates defaults on the host and skips missing continuation sources", async () => {
  const h = await createLaunchHarness();
  h.setModelDefault(undefined);
  const request = {
    ...requestFor("codex"),
    policy: { kind: "automatic" as const, actionId: "startBuilder" as const },
  };
  expect((await Effect.runPromise(h.service.launch(request))).failure?.message).toContain(
    "repository default model",
  );
  expect(h.starts).toHaveLength(0);
  h.setWorktreeExists(false);
  h.setTaskStatus("in_progress");
  const skipped = await Effect.runPromise(
    h.service.launch({
      ...request,
      launchAttemptId: "continuation",
      policy: { kind: "automatic", actionId: "startReviewQaFeedbacks" },
    }),
  );
  expect(skipped.phase).toBe("skipped");
  expect(skipped.skipReason).toContain("task worktree");
});

test("preparation-only launch sends no first instruction", async () => {
  const h = await createLaunchHarness();
  const result = await Effect.runPromise(
    h.service.launch({
      ...requestFor("codex"),
      policy: {
        kind: "manual",
        actionId: "build_implementation_start",
        decision: { startMode: "fresh", selectedModel: modelFor("codex"), speed: "fast" },
      },
      instruction: { kind: "none" },
    }),
  );
  expect(result).toMatchObject({
    phase: "completed",
    acceptance: "not_submitted",
    ownershipSaved: true,
  });
  expect(h.sends).toHaveLength(0);
  expect(h.startInputs[0]?.speed).toBe("fast");
  expect(h.records[0]?.speed).toBe("fast");
});

test("pre-start publication failure reports the committed action without creating a session", async () => {
  const h = await createLaunchHarness();
  h.setTaskStatus("human_review");
  h.setPublishFailure();
  const result = await Effect.runPromise(
    h.service.launch({
      ...requestFor("codex"),
      policy: {
        kind: "manual",
        actionId: "build_after_human_request_changes",
        decision: { startMode: "fresh", selectedModel: modelFor("codex") },
      },
      instruction: { kind: "kickoff", text: "Apply feedback", feedback: "Review feedback" },
      beforeStartAction: { action: "human_request_changes", note: "Review feedback" },
    }),
  );
  expect(result.phase).toBe("failed");
  expect(result.completedPreStartActions).toEqual(["human_request_changes"]);
  expect(h.getTask().status).toBe("in_progress");
  expect(h.starts).toHaveLength(0);
});

test("fresh QA requests remain distinct and revalidate after waiting", async () => {
  const h = await createLaunchHarness();
  h.setTaskStatus("ai_review");
  h.settings.autopilot.alwaysStartQaReviewsFresh = true;
  h.records.push({
    externalSessionId: "old-qa",
    runtimeKind: "codex",
    workingDirectory: "/worktrees/task",
    role: "qa",
    startedAt: timestamp,
    selectedModel: modelFor("codex"),
  });
  const request: WorkflowLaunchRequest = {
    ...requestFor("codex"),
    policy: { kind: "automatic", actionId: "startQa" },
  };
  await Effect.runPromise(
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      h.setSendGate(Deferred.await(gate));
      const first = yield* Effect.forkChild(h.service.launch(request));
      yield* Deferred.await(h.sendEntered);
      const second = yield* Effect.forkChild(
        h.service.launch({ ...request, launchAttemptId: "second" }),
      );
      yield* Effect.yieldNow;
      expect(h.starts).toHaveLength(1);
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
    }),
  );
  expect(h.starts).toEqual(["session-1", "session-2"]);
  expect(h.resumes).toHaveLength(0);
  expect(h.sends).toHaveLength(2);
});

test("automatic model and prompt selection uses role and repository overrides on the host", async () => {
  const h = await createLaunchHarness();
  h.setModelDefault(undefined);
  h.config.agentDefaults.build = modelFor("codex");
  h.settings.globalPromptOverrides["kickoff.build_implementation_start"] = {
    template: "Global kickoff",
    baseVersion: 1,
    enabled: true,
  };
  h.config.promptOverrides["kickoff.build_implementation_start"] = {
    template: "Repository kickoff {{task.id}}",
    baseVersion: 1,
    enabled: true,
  };
  h.config.promptOverrides["system.role.build.base"] = {
    template: "Repository system",
    baseVersion: 1,
    enabled: true,
  };
  const result = await Effect.runPromise(
    h.service.launch({
      ...requestFor("codex"),
      policy: { kind: "automatic", actionId: "startBuilder" },
      instruction: { kind: "kickoff" },
    }),
  );
  expect(result.phase).toBe("completed");
  expect(h.sends[0]?.model).toEqual(modelFor("codex"));
  expect(h.sends[0]?.parts).toEqual([{ kind: "text", text: "Repository kickoff task" }]);
  expect(h.sends[0]?.systemPrompt).toContain("Repository system");
});

test("invalid target rejects human feedback before the task mutation", async () => {
  const h = await createLaunchHarness();
  h.setTaskStatus("human_review");
  const result = await Effect.runPromise(
    h.service.launch({
      ...requestFor("codex"),
      policy: {
        kind: "manual",
        actionId: "build_after_human_request_changes",
        decision: { startMode: "fresh", selectedModel: modelFor("codex") },
      },
      instruction: { kind: "kickoff", feedback: "Required changes" },
      beforeStartAction: { action: "human_request_changes", note: "Required changes" },
      targetWorkingDirectory: "/other",
    }),
  );
  expect(result.phase).toBe("failed");
  expect(result.completedPreStartActions).toEqual([]);
  expect(h.getTask().status).toBe("human_review");
  expect(h.starts).toHaveLength(0);
});

test.each([{ variant: "not-in-catalog" }, { profileId: "not-in-catalog" }])(
  "invalid configured model options reject before creating a native session: %j",
  async (patch) => {
    const h = await createLaunchHarness();
    h.setModelDefault({ ...modelFor("codex"), ...patch });
    const result = await Effect.runPromise(
      h.service.launch({
        ...requestFor("codex"),
        policy: { kind: "automatic", actionId: "startBuilder" },
      }),
    );
    expect(result.phase).toBe("failed");
    expect(result.failure?.message).toContain("unavailable");
    expect(h.starts).toHaveLength(0);
    expect(h.sends).toHaveLength(0);
  },
);

test("automatic Pull Request launch reports provider and source prerequisites without a browser", async () => {
  const h = await createLaunchHarness();
  h.setTaskStatus("human_review");
  const request: WorkflowLaunchRequest = {
    ...requestFor("codex"),
    policy: { kind: "automatic", actionId: "startGeneratePullRequest" },
    instruction: { kind: "kickoff" },
  };
  const providerMissing = await Effect.runPromise(h.service.launch(request));
  expect(providerMissing.phase).toBe("skipped");
  expect(providerMissing.skipReason).toContain("does not support Pull Requests");
  h.enablePullRequests();
  const sourceMissing = await Effect.runPromise(
    h.service.launch({ ...request, launchAttemptId: "source-missing" }),
  );
  expect(sourceMissing.phase).toBe("skipped");
  expect(sourceMissing.skipReason).toContain("No build session");
  expect(h.starts).toHaveLength(0);
  expect(h.forks).toHaveLength(0);
  const source: AgentSessionRecord = {
    externalSessionId: "source",
    runtimeKind: "codex",
    workingDirectory: "/worktrees/task",
    role: "build",
    startedAt: timestamp,
    selectedModel: modelFor("codex"),
    speed: "fast",
  };
  h.records.push(source);
  for (const speed of ["fast", null]) {
    source.speed = speed;
    const result = await Effect.runPromise(
      h.service.launch({ ...request, launchAttemptId: `source-${speed ?? "unknown"}` }),
    );
    expect(result).toMatchObject({ phase: "completed", acceptance: "accepted" });
    expect(h.forkInputs.at(-1)).toMatchObject({
      parentExternalSessionId: "source",
      speed: "standard",
    });
    expect(h.records.at(-1)?.speed).toBe("standard");
    expect(h.records[0]?.speed).toBe(speed);
  }
});

test.each(["opencode", "codex", "claude"] as const)(
  "Spec and Planner %s launches use host prompts and preserve task status",
  async (kind) => {
    for (const actionId of ["spec_initial", "planner_initial"] as const) {
      const h = await createLaunchHarness(kind);
      h.setTaskType("feature");
      h.setTaskStatus(actionId === "spec_initial" ? "open" : "spec_ready");
      const expectedStatus = h.getTask().status;
      const role = actionId === "spec_initial" ? "spec" : "planner";
      const result = await Effect.runPromise(
        h.service.launch({
          ...requestFor(kind),
          policy: {
            kind: "manual",
            actionId,
            decision: { startMode: "fresh", selectedModel: modelFor(kind) },
          },
          instruction: { kind: "kickoff" },
        }),
      );
      expect(result).toMatchObject({ phase: "completed", role, acceptance: "accepted" });
      expect(h.records[0]?.role).toBe(role);
      expect(h.getTask().status).toBe(expectedStatus);
      expect(h.sends[0]?.systemPrompt).toContain("Task context");
      expect(h.sends[0]?.parts[0]).toMatchObject({
        kind: "text",
        text: expect.stringContaining("task"),
      });
    }
  },
);
