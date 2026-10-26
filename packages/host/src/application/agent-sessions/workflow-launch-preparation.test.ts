import { expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import type { AgentSessionStartMode, WorkflowLaunchRequest } from "@openducktor/contracts";
import { createTaskWorkflow } from "@openducktor/workflows";
import {
  reviewTaskDefinition,
  reviewTaskPromptTemplates,
} from "@openducktor/workflows/test-support";
import { reviewTaskWorkflows } from "../../test-support/task-workflows";
import {
  type AutomaticLaunchInput,
  createLaunchHarness,
  requestFor,
  modelFor,
} from "./test-support/workflow-launch-harness";

test("invalid workspace, repository, and task fail before native session creation", async () => {
  for (const patch of [{ workspaceId: "unknown" }, { repoPath: "/other" }, { taskId: "missing" }]) {
    const h = await createLaunchHarness();
    const result = await Effect.runPromise(h.service.launch({ ...requestFor("codex"), ...patch }));
    expect(result.status).toBe("failed");
    expect(result.failure?.message).toBeTruthy();
    expect(h.starts).toHaveLength(0);
    expect(h.sends).toHaveLength(0);
  }
});

test("a fresh target outside the canonical task worktree fails before any task mutation", async () => {
  const h = await createLaunchHarness();
  h.setTaskStatus("human_review");
  const request = (targetWorkingDirectory: string): WorkflowLaunchRequest => ({
    ...requestFor("codex"),
    policy: {
      kind: "manual",
      actionId: "build_after_human_request_changes",
      decision: { startMode: "fresh", selectedModel: modelFor("codex"), targetWorkingDirectory },
    },
    instruction: { kind: "kickoff", feedback: "Required changes" },
    beforeStartAction: { action: "human_request_changes", note: "Required changes" },
  });
  const rejected = await Effect.runPromise(h.service.launch(request("/other")));
  expect(rejected).toMatchObject({
    status: "failed",
    failure: { message: expect.stringContaining("canonical task worktree /worktrees/task") },
  });
  expect(rejected.session).toBeUndefined();
  expect(h.getTask().status).toBe("human_review");
  expect(h.starts).toHaveLength(0);

  const accepted = await Effect.runPromise(h.service.launch(request("/worktrees/task")));
  expect(accepted).toMatchObject({
    status: "completed",
    session: { externalSessionId: "session-1", workingDirectory: "/worktrees/task" },
  });
  expect(h.getTask().status).toBe("in_progress");
});

test("a saved override with an unsupported placeholder fails before any task mutation", async () => {
  const h = await createLaunchHarness();
  h.setTaskStatus("human_review");
  h.setPromptOverrides({
    "system.shared.task_context": {
      template: "Task {{task.id}}, QA required: {{task.qaRequired}}",
      baseVersion: 1,
    },
  });
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
    }),
  );
  expect(result).toMatchObject({
    status: "failed",
    failure: {
      message:
        'Prompt template "system.shared.task_context" uses unsupported placeholder "task.qaRequired". Edit or disable this prompt override in Settings.',
    },
  });
  expect(h.getTask().status).toBe("human_review");
  expect(h.starts).toHaveLength(0);
});

test("manual fresh launch starts a model that the catalog does not list without loading the catalog", async () => {
  const h = await createLaunchHarness();
  const selectedModel = { ...modelFor("codex"), modelId: "unlisted" };
  const result = await Effect.runPromise(
    h.service.launch({
      ...requestFor("codex"),
      policy: {
        kind: "manual",
        actionId: "build_implementation_start",
        decision: { startMode: "fresh", selectedModel },
      },
    }),
  );
  expect(result).toMatchObject({ status: "completed", model: selectedModel });
  expect(h.catalogLoads()).toBe(0);
  expect(h.sends[0]).not.toHaveProperty("model");
});

test("automatic launch fails when no role or repository default model is set", async () => {
  const h = await createLaunchHarness();
  h.setModelDefault(undefined);
  const result = await Effect.runPromise(
    h.launchAutomatic({
      ...requestFor("codex"),
      policy: { kind: "automatic", actionId: "startBuilder" },
    }),
  );
  expect(result.status).toBe("failed");
  expect(result.failure?.message).toContain("repository default model");
  expect(h.starts).toHaveLength(0);
});

test("automatic Builder continuation skips when the task has no worktree", async () => {
  const h = await createLaunchHarness();
  h.setWorktreeExists(false);
  h.setTaskStatus("in_progress");
  const result = await Effect.runPromise(
    h.launchAutomatic({
      ...requestFor("codex"),
      policy: { kind: "automatic", actionId: "startReviewQaFeedbacks" },
    }),
  );
  expect(result.status).toBe("skipped");
  expect(result.skipReason).toContain("task worktree");
  expect(result.failure).toBeUndefined();
  expect(h.starts).toHaveLength(0);
});

test("automatic fresh launch fills an unset default variant from the runtime catalog", async () => {
  const h = await createLaunchHarness();
  h.setModelDefault({ runtimeKind: "codex", providerId: "provider", modelId: "model" });
  const result = await Effect.runPromise(
    h.launchAutomatic({
      ...requestFor("codex"),
      policy: { kind: "automatic", actionId: "startBuilder" },
    }),
  );
  expect(result).toMatchObject({ status: "completed", model: modelFor("codex") });
  expect(h.catalogLoads()).toBe(1);
  expect(h.records[0]?.selectedModel).toEqual(modelFor("codex"));
  expect(h.sends[0]).not.toHaveProperty("model");
});

test("automatic fresh launch starts the model that a saved alias default points to", async () => {
  const h = await createLaunchHarness();
  h.setModelDefault({ ...modelFor("codex"), modelId: "model-alias" });
  const result = await Effect.runPromise(
    h.launchAutomatic({
      ...requestFor("codex"),
      policy: { kind: "automatic", actionId: "startBuilder" },
    }),
  );
  expect(result).toMatchObject({ status: "completed", model: modelFor("codex") });
  expect(h.sends[0]).not.toHaveProperty("model");
});

test.each([
  [{ variant: "not-in-catalog" }, "failed"],
  [{ profileId: "unlisted-profile" }, "completed"],
] as const)(
  "automatic fresh launch checks the configured %j against the catalog: %s",
  async (patch, status) => {
    const h = await createLaunchHarness();
    h.setModelDefault({ ...modelFor("codex"), ...patch });
    const result = await Effect.runPromise(
      h.launchAutomatic({
        ...requestFor("codex"),
        policy: { kind: "automatic", actionId: "startBuilder" },
      }),
    );
    expect(result.status).toBe(status);
    if (status === "failed") {
      expect(result.failure?.message).toContain("is not available for runtime codex");
      expect(h.starts).toHaveLength(0);
      expect(h.sends).toHaveLength(0);
    } else {
      // The catalog lists no profiles, so it cannot reject the configured profile.
      expect(result.model).toEqual({ ...modelFor("codex"), ...patch });
      expect(h.starts).toHaveLength(1);
    }
  },
);

test("preparation-only launch sends no first instruction", async () => {
  const h = await createLaunchHarness();
  const result = await Effect.runPromise(
    h.service.launch({ ...requestFor("codex"), instruction: { kind: "none" } }),
  );
  expect(result).toMatchObject({
    status: "completed",
    session: { externalSessionId: "session-1" },
  });
  expect(result.acceptedMessage).toBeUndefined();
  expect(h.sends).toHaveLength(0);
});

test("a pre-start publication failure fails the launch after the task mutation without a session", async () => {
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
  expect(result).toMatchObject({
    status: "failed",
    failure: { message: "Ownership publication failed" },
  });
  expect(result.session).toBeUndefined();
  expect(h.getTask().status).toBe("in_progress");
  expect(h.starts).toHaveLength(0);
});

test("fresh QA requests remain distinct and revalidate after waiting", async () => {
  const h = await createLaunchHarness();
  h.setTaskStatus("ai_review");
  h.settings.autopilot.alwaysStartQaReviewsFresh = true;
  h.addTaskSession("old-qa", { role: "qa" });
  const request: AutomaticLaunchInput = {
    ...requestFor("codex"),
    policy: { kind: "automatic", actionId: "startQa" },
  };
  await Effect.runPromise(
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      h.setSendGate(Deferred.await(gate));
      const first = yield* Effect.forkChild(h.launchAutomatic(request));
      yield* Deferred.await(h.sendEntered);
      const second = yield* Effect.forkChild(h.launchAutomatic(request));
      yield* Effect.yieldNow;
      expect(h.starts).toHaveLength(1);
      yield* Deferred.succeed(gate, undefined);
      expect((yield* Fiber.join(first)).status).toBe("completed");
      expect((yield* Fiber.join(second)).status).toBe("completed");
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
    h.launchAutomatic({
      ...requestFor("codex"),
      policy: { kind: "automatic", actionId: "startBuilder" },
      instruction: { kind: "kickoff" },
    }),
  );
  expect(result.status).toBe("completed");
  expect(h.sends[0]).not.toHaveProperty("model");
  expect(h.sends[0]?.parts).toEqual([{ kind: "text", text: "Repository kickoff task" }]);
  expect(h.sends[0]?.systemPrompt).toContain("Repository system");
});

test("automatic Pull Request launch skips missing prerequisites and forks the latest Builder model", async () => {
  const h = await createLaunchHarness();
  h.setTaskStatus("human_review");
  const request: AutomaticLaunchInput = {
    ...requestFor("codex"),
    policy: { kind: "automatic", actionId: "startGeneratePullRequest" },
    instruction: { kind: "kickoff" },
  };
  const providerMissing = await Effect.runPromise(h.launchAutomatic(request));
  expect(providerMissing.status).toBe("skipped");
  expect(providerMissing.skipReason).toContain("does not support Pull Requests");
  h.enablePullRequests();
  const sourceMissing = await Effect.runPromise(h.launchAutomatic(request));
  expect(sourceMissing.status).toBe("skipped");
  expect(sourceMissing.skipReason).toContain("No build session");
  expect(h.starts).toHaveLength(0);
  expect(h.forks).toHaveLength(0);

  const builderModel = { ...modelFor("codex"), modelId: "retired-builder-model" };
  h.addTaskSession("builder", { selectedModel: builderModel });
  const forked = await Effect.runPromise(h.launchAutomatic(request));
  expect(forked).toMatchObject({
    status: "completed",
    startMode: "fork",
    model: builderModel,
    session: { externalSessionId: "fork-1" },
  });
  expect(h.forks).toEqual(["builder"]);
  expect(h.catalogLoads()).toBe(0);
});

test("automatic Pull Request launch skips when the Git provider is not enabled", async () => {
  const h = await createLaunchHarness();
  h.setTaskStatus("human_review");
  h.addTaskSession("builder");
  h.enablePullRequests(false);
  const result = await Effect.runPromise(
    h.launchAutomatic({
      ...requestFor("codex"),
      policy: { kind: "automatic", actionId: "startGeneratePullRequest" },
      instruction: { kind: "kickoff" },
    }),
  );
  expect(result).toMatchObject({
    status: "skipped",
    skipReason: "GitHub provider is not enabled for this repository.",
  });
  expect(h.forks).toHaveLength(0);
});

test("automatic Pull Request launch skips when the Git provider cannot be read", async () => {
  const h = await createLaunchHarness();
  h.setTaskStatus("human_review");
  h.addTaskSession("builder");
  h.setProviderFailure();
  const result = await Effect.runPromise(
    h.launchAutomatic({
      ...requestFor("codex"),
      policy: { kind: "automatic", actionId: "startGeneratePullRequest" },
      instruction: { kind: "kickoff" },
    }),
  );
  expect(result).toMatchObject({
    status: "skipped",
    skipReason: "Could not load the current Git provider: Provider read failed",
  });
  expect(result.failure).toBeUndefined();
  expect(h.forks).toHaveLength(0);
  expect(h.sends).toHaveLength(0);
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
      expect(result).toMatchObject({ status: "completed", role });
      expect(result.acceptedMessage).toBeDefined();
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

test("a custom workflow launch starts its step role with the prompts of that workflow", async () => {
  const h = await createLaunchHarness("codex", {
    taskWorkflows: reviewTaskWorkflows,
    task: { issueType: "article", status: "backlog" },
  });
  const result = await Effect.runPromise(
    h.service.launch({
      ...requestFor("codex"),
      policy: {
        kind: "manual",
        actionId: "write_start",
        decision: { startMode: "fresh", selectedModel: modelFor("codex") },
      },
      instruction: { kind: "kickoff" },
    }),
  );
  expect(result).toMatchObject({ status: "completed", role: "writer" });
  expect(h.getTask().status).toBe("writing");
  expect(h.sends[0]?.parts).toEqual([{ kind: "text", text: "Write the draft for task." }]);
  expect(h.sends[0]?.systemPrompt).toContain("You are the writer of task task.");
});

test("automatic launch checks the worktree of an action that needs it without reuse", async () => {
  const definition = reviewTaskDefinition();
  for (const step of definition.steps)
    if (step.kind === "agent")
      for (const action of step.launchActions)
        if (action.id === "write_revise") {
          action.startModes = ["fresh"];
          action.defaultStartMode = "fresh";
        }
  definition.automations = definition.automations.map((automation) =>
    automation.id === "startRevision" ? { ...automation, startMode: "fresh" as const } : automation,
  );
  const workflow = createTaskWorkflow(definition, reviewTaskPromptTemplates);
  const launch = async (worktreeExists: boolean) => {
    const h = await createLaunchHarness("codex", {
      taskWorkflows: { forRepo: () => workflow, workflows: [workflow] },
      task: { issueType: "article", status: "writing" },
    });
    h.setWorktreeExists(worktreeExists);
    return Effect.runPromise(
      h.launchAutomatic({
        ...requestFor("codex"),
        policy: { kind: "automatic", actionId: "startRevision" },
      }),
    );
  };

  expect(await launch(false)).toMatchObject({ status: "skipped", role: "writer" });
  expect(await launch(true)).toMatchObject({ status: "completed", role: "writer" });
});

const launchRevision = async (
  startModes: AgentSessionStartMode[],
  defaultStartMode: AgentSessionStartMode,
  writerSession: boolean,
) => {
  const definition = reviewTaskDefinition();
  for (const step of definition.steps)
    if (step.kind === "agent")
      for (const action of step.launchActions)
        if (action.id === "write_revise") Object.assign(action, { startModes, defaultStartMode });
  definition.automations = definition.automations.map(
    ({ startMode: _startMode, ...automation }) => automation,
  );
  const workflow = createTaskWorkflow(definition, reviewTaskPromptTemplates);
  const h = await createLaunchHarness("codex", {
    taskWorkflows: { forRepo: () => workflow, workflows: [workflow] },
    task: { issueType: "article", status: "writing" },
  });
  if (writerSession) h.addTaskSession("writer-1", { role: "writer" });
  const result = await Effect.runPromise(
    h.launchAutomatic({
      ...requestFor("codex"),
      policy: { kind: "automatic", actionId: "startRevision" },
    }),
  );
  return { h, result };
};

test.each([
  [["fresh", "reuse"], "fresh", true, "fresh"],
  [["fresh", "reuse"], "reuse", true, "reuse"],
  [["fresh", "reuse"], "reuse", false, "fresh"],
  [["fork"], "fork", true, "fork"],
] as const)(
  "automatic launch with start modes %p and default %p, writer session %p, starts %p",
  async (startModes, defaultStartMode, writerSession, startMode) => {
    const { result } = await launchRevision([...startModes], defaultStartMode, writerSession);

    expect(result).toMatchObject({ status: "completed", role: "writer", startMode });
  },
);

test.each([
  [["fork"], "fork", "No writer session is available to fork"],
  [["reuse"], "reuse", "No Writer session in the task worktree is available to reuse"],
] as const)(
  "automatic launch with start modes %p skips without a session to continue",
  async (startModes, defaultStartMode, reason) => {
    const { h, result } = await launchRevision([...startModes], defaultStartMode, false);

    expect(result).toMatchObject({ status: "skipped", role: "writer" });
    expect(result.skipReason).toContain(reason);
    expect(h.starts).toHaveLength(0);
  },
);
