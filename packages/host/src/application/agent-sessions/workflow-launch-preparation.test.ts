import { expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import type { AgentSessionStartMode, WorkflowLaunchRequest } from "@openducktor/contracts";
import { createTaskWorkflow } from "@openducktor/workflows";
import { specPlanBuildPromptKey, rolePromptKey } from "@openducktor/workflows/test-support";
import {
  reviewTaskDefinition,
  reviewTaskPromptTemplates,
  reviewTaskRoles,
} from "@openducktor/workflows/test-support";
import { reviewTaskWorkflows, singleTaskWorkflow } from "../../test-support/task-workflows";
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
    beforeStartAction: { eventId: "human-request-changes" },
  });
  const rejected = await Effect.runPromise(h.service.launch(request("/other")));
  expect(rejected).toMatchObject({
    status: "failed",
    failure: { message: expect.stringContaining("canonical task worktree /worktrees/task") },
  });
  expect(rejected.session).toBeUndefined();
  expect(h.getTask().status).toBe("human_review");
  expect(h.starts).toHaveLength(0);
  expect(h.appliedEvents).toEqual([]);

  const accepted = await Effect.runPromise(h.service.launch(request("/worktrees/task")));
  expect(accepted).toMatchObject({
    status: "completed",
    session: { externalSessionId: "session-1", workingDirectory: "/worktrees/task" },
  });
  expect(h.appliedEvents).toEqual(["human-request-changes"]);
  expect(h.getTask().status).toBe("in_progress");
});

test("a launch without the human feedback context cannot commit an event before its start", async () => {
  const h = await createLaunchHarness();
  h.setTaskStatus("human_review");
  const result = await Effect.runPromise(
    h.service.launch({
      ...requestFor("codex"),
      policy: {
        kind: "manual",
        actionId: "qa_review",
        decision: { startMode: "fresh", selectedModel: modelFor("codex") },
      },
      beforeStartAction: { eventId: "human-request-changes" },
    }),
  );
  expect(result).toMatchObject({
    status: "failed",
    failure: {
      message:
        "Action 'qa_review' collects no human feedback, so it cannot commit event 'human-request-changes' before its start. Start the launch without that event.",
    },
  });
  expect(h.appliedEvents).toEqual([]);
  expect(h.getTask().status).toBe("human_review");
  expect(h.starts).toHaveLength(0);
});

test("a saved append with a placeholder that the prompt cannot fill fails before any task mutation", async () => {
  const h = await createLaunchHarness();
  h.setTaskStatus("human_review");
  h.setPromptAppends({
    [specPlanBuildPromptKey("messages.build_requested_changes")]: {
      text: "Compare with {{git.targetBranch}}.",
      enabled: true,
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
      beforeStartAction: { eventId: "human-request-changes" },
    }),
  );
  expect(result).toMatchObject({
    status: "failed",
    failure: {
      message: expect.stringContaining(
        'The repository append of prompt "messages.build_requested_changes" has a placeholder problem. This prompt cannot fill {{git.targetBranch}}.',
      ),
    },
  });
  expect(h.getTask().status).toBe("human_review");
  expect(h.starts).toHaveLength(0);
});

test("a launch with its own first message is not blocked by a bad kickoff layer", async () => {
  const h = await createLaunchHarness();
  h.setTaskStatus("human_review");
  h.setPromptAppends({
    [specPlanBuildPromptKey("messages.build_requested_changes")]: {
      text: "Compare with {{git.targetBranch}}.",
      enabled: true,
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
      instruction: { kind: "kickoff", text: "Fix the review notes.", feedback: "Required changes" },
      beforeStartAction: { eventId: "human-request-changes" },
    }),
  );
  expect(result).not.toMatchObject({ status: "failed" });
  expect(h.starts).toHaveLength(1);
});

test("a saved override with an unsupported placeholder fails before any task mutation", async () => {
  const h = await createLaunchHarness();
  h.setTaskStatus("human_review");
  h.setPromptOverrides({
    [specPlanBuildPromptKey("workflow.task_context")]: {
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
      beforeStartAction: { eventId: "human-request-changes" },
    }),
  );
  expect(result).toMatchObject({
    status: "failed",
    failure: {
      message:
        'The repository override of prompt "workflow.task_context" has a placeholder problem. Unsupported placeholder: {{task.qaRequired}}. This prompt can fill: {{role}}, {{role.allowedTools}}, {{task.id}}, {{task.title}}, {{task.issueType}}, {{task.status}}, {{task.description}}. Edit or turn off this override in Settings.',
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
      beforeStartAction: { eventId: "human-request-changes" },
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
  h.settings.globalPromptOverrides[specPlanBuildPromptKey("messages.build_start")] = {
    template: "Global kickoff",
    baseVersion: 1,
    enabled: true,
  };
  h.config.promptOverrides[specPlanBuildPromptKey("messages.build_start")] = {
    template: "Repository kickoff {{task.id}}",
    baseVersion: 1,
    enabled: true,
  };
  h.config.promptOverrides[rolePromptKey("build")] = {
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
  expect(h.settingsReads.global).toHaveBeenCalledTimes(1);
  expect(h.settingsReads.snapshot).not.toHaveBeenCalled();
});

test("automatic Pull Request launch skips missing prerequisites and forks the latest Builder model", async () => {
  const h = await createLaunchHarness();
  h.setTaskStatus("human_review");
  const request: AutomaticLaunchInput = {
    ...requestFor("codex"),
    policy: { kind: "automatic", actionId: "startGeneratePullRequest" },
    instruction: { kind: "kickoff" },
  };
  const sourceMissing = await Effect.runPromise(h.launchAutomatic(request));
  expect(sourceMissing).toMatchObject({
    status: "skipped",
    skipReason: "No Builder session is available to create the pull request for task task.",
  });
  const builderModel = { ...modelFor("codex"), modelId: "retired-builder-model" };
  h.addTaskSession("builder", { selectedModel: builderModel });
  const providerMissing = await Effect.runPromise(h.launchAutomatic(request));
  expect(providerMissing.status).toBe("skipped");
  expect(providerMissing.skipReason).toContain("does not support Pull Requests");
  expect(h.starts).toHaveLength(0);
  expect(h.forks).toHaveLength(0);

  h.enablePullRequests();
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

const launchPullRequestAutomation = async (
  pullRequestRoles: string[],
  sessions: { id: string; role: string; startedAt: string }[],
) => {
  const definition = reviewTaskDefinition();
  definition.pullRequestRoles = pullRequestRoles;
  definition.automations.push({
    id: "startPullRequest",
    label: "Generate Pull Request",
    description: "Generate the pull request.",
    launchActionId: "pull_request",
  });
  const workflow = createTaskWorkflow(definition, reviewTaskPromptTemplates, reviewTaskRoles);
  const h = await createLaunchHarness("codex", {
    taskWorkflows: singleTaskWorkflow(workflow),
    task: { issueType: "feature", status: "approval" },
  });
  h.enablePullRequests();
  for (const { id, role, startedAt } of sessions) h.addTaskSession(id, { role, startedAt });
  const result = await Effect.runPromise(
    h.launchAutomatic({
      ...requestFor("codex"),
      policy: { kind: "automatic", actionId: "startPullRequest" },
      instruction: { kind: "kickoff" },
    }),
  );
  return { h, result };
};

test.each([
  [["writer", "editor"], "writer"],
  [[], "writer"],
  [["writer", "editor"], "editor"],
  [[], "editor"],
] as const)(
  "automatic Pull Request launch with pull request roles %p continues the latest %s session",
  async (pullRequestRoles, latestRole) => {
    const older = "2026-10-03T12:00:00.000Z";
    const newer = "2026-10-03T13:00:00.000Z";
    const { h, result } = await launchPullRequestAutomation(
      [...pullRequestRoles],
      [
        { id: "writer-1", role: "writer", startedAt: latestRole === "writer" ? newer : older },
        { id: "editor-1", role: "editor", startedAt: latestRole === "editor" ? newer : older },
      ],
    );
    expect(result).toMatchObject({
      status: "completed",
      role: latestRole,
      startMode: "reuse",
      session: { externalSessionId: `${latestRole}-1` },
    });
    expect(h.starts).toHaveLength(0);
    expect(h.sends).toHaveLength(1);
  },
);

test("automatic Pull Request launch ignores a newer session of a role that cannot create it", async () => {
  const { result } = await launchPullRequestAutomation(
    ["writer"],
    [
      { id: "writer-1", role: "writer", startedAt: "2026-10-03T12:00:00.000Z" },
      { id: "editor-1", role: "editor", startedAt: "2026-10-03T13:00:00.000Z" },
    ],
  );
  expect(result).toMatchObject({
    status: "completed",
    role: "writer",
    session: { externalSessionId: "writer-1" },
  });
});

test("automatic Pull Request launch skips when no pull request role has a session", async () => {
  const { h, result } = await launchPullRequestAutomation([], []);
  expect(result).toMatchObject({
    status: "skipped",
    skipReason:
      "No Writer or Editor session is available to create the pull request for task task.",
  });
  expect(h.starts).toHaveLength(0);
  expect(h.forks).toHaveLength(0);
  expect(h.sends).toHaveLength(0);
});

test("a manual Pull Request launch runs only as a pull request role of its source session", async () => {
  const h = await createLaunchHarness();
  h.enablePullRequests();
  h.setTaskStatus("human_review");
  const qaSession = h.addTaskSession("qa-session", { role: "qa" });
  const launch = (role: string | undefined) => {
    const policy: WorkflowLaunchRequest["policy"] = {
      kind: "manual",
      actionId: "pull_request",
      decision: { startMode: "reuse", sourceSession: qaSession },
    };
    if (role !== undefined) policy.role = role;
    return h.service.launch({ ...requestFor("codex"), policy, instruction: { kind: "kickoff" } });
  };
  expect((await Effect.runPromise(Effect.flip(launch(undefined)))).message).toContain(
    "needs the role of its session",
  );
  expect((await Effect.runPromise(Effect.flip(launch("qa")))).message).toContain(
    'Role "qa" cannot create pull requests',
  );
  expect(await Effect.runPromise(launch("build"))).toMatchObject({
    status: "failed",
    failure: { message: expect.stringContaining("does not own the selected build source") },
  });
  expect(h.sends).toHaveLength(0);
});

test("a manual Pull Request launch fails while the task approval is not available", async () => {
  const h = await createLaunchHarness();
  h.enablePullRequests();
  h.setTaskStatus("in_progress");
  const sourceSession = h.addTaskSession("builder");
  const result = await Effect.runPromise(
    h.service.launch({
      ...requestFor("codex"),
      policy: {
        kind: "manual",
        actionId: "pull_request",
        role: "build",
        decision: { startMode: "reuse", sourceSession },
      },
      instruction: { kind: "kickoff" },
    }),
  );
  expect(result).toMatchObject({
    status: "failed",
    failure: {
      message: expect.stringContaining("Pull request generation is not available for task"),
    },
  });
  expect(h.sends).toHaveLength(0);
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
    task: { issueType: "feature", status: "open" },
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
  const workflow = createTaskWorkflow(definition, reviewTaskPromptTemplates, reviewTaskRoles);
  const launch = async (worktreeExists: boolean) => {
    const h = await createLaunchHarness("codex", {
      taskWorkflows: singleTaskWorkflow(workflow),
      task: { issueType: "feature", status: "writing" },
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

const launchCustomAutomation = async ({
  automationId,
  launchActionId,
  role,
  status,
  startModes,
  defaultStartMode,
  roleSession,
  freshReviews = false,
}: {
  automationId: string;
  launchActionId: string;
  role: string;
  status: string;
  startModes: AgentSessionStartMode[];
  defaultStartMode: AgentSessionStartMode;
  roleSession: boolean;
  freshReviews?: boolean;
}) => {
  const definition = reviewTaskDefinition();
  for (const step of definition.steps)
    if (step.kind === "agent")
      for (const action of step.launchActions)
        if (action.id === launchActionId) Object.assign(action, { startModes, defaultStartMode });
  definition.automations = definition.automations.map(
    ({ startMode: _startMode, ...automation }) => automation,
  );
  const workflow = createTaskWorkflow(definition, reviewTaskPromptTemplates, reviewTaskRoles);
  const h = await createLaunchHarness("codex", {
    taskWorkflows: singleTaskWorkflow(workflow),
    task: { issueType: "feature", status },
  });
  h.settings.autopilot.alwaysStartQaReviewsFresh = freshReviews;
  if (roleSession) h.addTaskSession(`${role}-1`, { role });
  const result = await Effect.runPromise(
    h.launchAutomatic({
      ...requestFor("codex"),
      policy: { kind: "automatic", actionId: automationId },
    }),
  );
  return { h, result };
};

const launchRevision = (
  startModes: AgentSessionStartMode[],
  defaultStartMode: AgentSessionStartMode,
  roleSession: boolean,
) =>
  launchCustomAutomation({
    automationId: "startRevision",
    launchActionId: "write_revise",
    role: "writer",
    status: "writing",
    startModes,
    defaultStartMode,
    roleSession,
  });

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

test.each([
  ["reuse", false, "reuse"],
  ["fork", false, "fork"],
  ["reuse", true, "fresh"],
  ["fork", true, "fresh"],
] as const)(
  "automatic %s of a role that writes a review, with fresh reviews %p, starts %p",
  async (defaultStartMode, freshReviews, startMode) => {
    const { result } = await launchCustomAutomation({
      automationId: "startEditor",
      launchActionId: "edit_review",
      role: "editor",
      status: "reviewing",
      startModes: ["fresh", defaultStartMode],
      defaultStartMode,
      roleSession: true,
      freshReviews,
    });

    expect(result).toMatchObject({ status: "completed", role: "editor", startMode });
  },
);

test("a feedback launch runs when its step is available in the state that its event gives", async () => {
  const definition = reviewTaskDefinition();
  const write = definition.steps.find(({ id }) => id === "write")!;
  write.availableWhen = { stateIn: ["open", "writing", "paused"] };
  const workflow = createTaskWorkflow(definition, reviewTaskPromptTemplates, reviewTaskRoles);
  const launchFeedback = async (status: string, eventId: string) => {
    const h = await createLaunchHarness("codex", {
      taskWorkflows: singleTaskWorkflow(workflow),
      task: { issueType: "feature", status },
    });
    const result = await Effect.runPromise(
      h.service.launch({
        ...requestFor("codex"),
        policy: {
          kind: "manual",
          actionId: "write_feedback",
          decision: { startMode: "fresh", selectedModel: modelFor("codex") },
        },
        instruction: { kind: "kickoff", feedback: "Shorten the intro" },
        beforeStartAction: { eventId },
      }),
    );
    return { h, result };
  };

  const accepted = await launchFeedback("approval", "request-rewrite");
  expect(accepted.result).toMatchObject({ status: "completed", role: "writer" });
  expect(accepted.h.appliedEvents).toEqual(["request-rewrite"]);
  expect(accepted.h.getTask().status).toBe("writing");

  const rejected = await launchFeedback("reviewing", "accept-review");
  expect(rejected.result).toMatchObject({
    status: "failed",
    failure: { message: "writer workflow is not available for task task." },
  });
  expect(rejected.h.appliedEvents).toEqual([]);
  expect(rejected.h.getTask().status).toBe("reviewing");
  expect(rejected.h.starts).toHaveLength(0);
});
