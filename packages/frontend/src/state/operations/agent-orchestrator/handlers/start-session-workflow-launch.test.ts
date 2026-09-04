import { describe, expect, test } from "bun:test";
import type { AgentEnginePort, AgentSessionSummary } from "@openducktor/core";
import { createSessionStartGate } from "@/features/session-start/session-start-gate";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { createTaskCardFixture } from "../test-utils";
import type { RuntimeInfo } from "../runtime/runtime";
import { createSessionMessagesState } from "../support/messages";
import type { StartSessionContext, StartSessionExecutionDependencies } from "./start-session.types";
import { STALE_START_ERROR } from "./start-session-constants";
import {
  registerWorkflowSessionLaunch,
  prepareWorkflowForkLaunch,
  prepareWorkflowFreshLaunch,
} from "./start-session-workflow-launch";

const REPO_PATH = "/tmp/repo";

const taskCard = () => createTaskCardFixture({ id: "task-1", title: "Implement feature" });

const unavailableBuildTaskCard = () =>
  createTaskCardFixture({
    id: "task-1",
    agentWorkflows: {
      spec: {
        required: false,
        canSkip: true,
        available: true,
        completed: false,
      },
      planner: {
        required: false,
        canSkip: true,
        available: true,
        completed: false,
      },
      builder: {
        required: true,
        canSkip: false,
        available: false,
        completed: false,
      },
      qa: {
        required: false,
        canSkip: true,
        available: false,
        completed: false,
      },
    },
  });

const createContext = (overrides: Partial<StartSessionContext> = {}): StartSessionContext => ({
  repoPath: REPO_PATH,
  workspaceId: "workspace-1",
  taskId: "task-1",
  role: "build",
  holdForPostStartMessage: false,
  isStaleRepoOperation: () => false,
  ...overrides,
});

const workflowSourceSession = (): AgentSessionState => ({
  externalSessionId: "source-session",
  sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
  runtimeKind: "opencode",
  status: "idle",
  runtimeStatusMessage: null,
  startedAt: "2026-08-21T09:00:00.000Z",
  workingDirectory: "/tmp/repo/worktree",
  livePresence: "unobserved",
  historyLoadState: "loaded",
  messages: createSessionMessagesState("source-session", []),
  contextUsage: null,
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: null,
});

type Harness = {
  calls: {
    ensureRuntime: Array<
      [Parameters<StartSessionExecutionDependencies["runtime"]["ensureRuntime"]>[3]]
    >;
    stopSession: string[];
    clearObservation: string[];
    bootstrapComplete: number;
    bootstrapAbort: number;
  };
  ctx: StartSessionContext;
  deps: StartSessionExecutionDependencies;
  setStale: () => void;
};

const createHarness = (
  options: {
    taskCards?: ReturnType<typeof taskCard>[];
    sourceSessions?: AgentSessionState[];
  } = {},
): Harness => {
  const calls: Harness["calls"] = {
    ensureRuntime: [],
    stopSession: [],
    clearObservation: [],
    bootstrapComplete: 0,
    bootstrapAbort: 0,
  };
  let stale = false;

  const bootstrap: NonNullable<RuntimeInfo["bootstrap"]> = {
    complete: async () => {
      calls.bootstrapComplete += 1;
    },
    abort: async () => {
      calls.bootstrapAbort += 1;
    },
  };

  const stopAdapter: Pick<AgentEnginePort, "stopSession"> = {
    stopSession: async (input: { externalSessionId: string }) => {
      calls.stopSession.push(input.externalSessionId);
    },
  };
  // SAFETY: workflow launch tests only exercise the stopSession method on this adapter seam.
  const adapter = stopAdapter as AgentEnginePort;

  const deps: StartSessionExecutionDependencies = {
    session: {
      replaceSession: () => undefined,
      readSessionSnapshot: (identity) =>
        (options.sourceSessions ?? [workflowSourceSession()]).find(
          (session) => session.externalSessionId === identity.externalSessionId,
        ) ?? null,
      loadSourceSession: async ({ sourceSession }) =>
        (options.sourceSessions ?? [workflowSourceSession()]).find(
          (session) => session.externalSessionId === sourceSession.externalSessionId,
        ) ?? null,
      loadAgentSessionHistory: async () => null,
      sessionStartGateRef: { current: createSessionStartGate() },
      clearSessionObservationState: (identity) => {
        calls.clearObservation.push(identity.externalSessionId);
      },
    },
    runtime: {
      adapter,
      canonicalizePath: async (path) => path,
      ensureRuntime: async (_repoPath, _taskId, _role, runtimeOptions) => {
        calls.ensureRuntime.push([runtimeOptions]);
        return {
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
          bootstrap,
        };
      },
    },
    task: {
      taskRef: { current: options.taskCards ?? [taskCard()] },
      loadTaskDocuments: async () => ({
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
      refreshSessionRecords: async () => undefined,
      refreshTaskData: async () => undefined,
      sendAgentMessage: async () => undefined,
    },
    model: {
      loadRepoPromptOverrides: async () => ({}),
      loadSettingsSnapshot: async () => createSettingsSnapshotFixture(),
    },
  };

  return {
    calls,
    ctx: createContext({
      isStaleRepoOperation: () => stale,
    }),
    deps,
    setStale: () => {
      stale = true;
    },
  };
};

const freshInput = () =>
  ({
    taskId: "task-1",
    role: "build",
    startMode: "fresh",
    selectedModel: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "build",
    },
  }) as const;

const forkInput = () =>
  ({
    taskId: "task-1",
    role: "build",
    startMode: "fork",
    selectedModel: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
    },
    sourceSession: {
      externalSessionId: "source-session",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
    },
  }) as const;

const registeredSessionState = (): AgentSessionState => ({
  externalSessionId: "external-commit",
  sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
  runtimeKind: "opencode",
  status: "idle",
  runtimeStatusMessage: null,
  startedAt: "2026-08-21T10:00:00.000Z",
  workingDirectory: "/tmp/repo/worktree",
  livePresence: "unobserved",
  historyLoadState: "loaded",
  messages: createSessionMessagesState("external-commit", []),
  contextUsage: null,
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: null,
});

const registrationInputFor = (harness: Harness) => {
  const summary: AgentSessionSummary = {
    externalSessionId: "external-commit",
    runtimeKind: "opencode",
    workingDirectory: "/tmp/repo/worktree",
    startedAt: "2026-08-21T10:00:00.000Z",
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
    status: "idle",
  };
  return {
    summary,
    identity: {
      externalSessionId: summary.externalSessionId,
      runtimeKind: summary.runtimeKind,
      workingDirectory: summary.workingDirectory,
    } satisfies AgentSessionIdentity,
    sessionState: registeredSessionState(),
    isStaleOperation: harness.ctx.isStaleRepoOperation,
    bootstrap: {
      complete: async () => {
        harness.calls.bootstrapComplete += 1;
      },
      abort: async () => {
        harness.calls.bootstrapAbort += 1;
      },
    },
    ctx: harness.ctx,
    deps: {
      session: harness.deps.session,
      runtime: harness.deps.runtime,
      task: harness.deps.task,
    },
  };
};

describe("prepareWorkflowFreshLaunch", () => {
  test("prepares the workflow launch input with association, prompt, and runtime context", async () => {
    const harness = createHarness();

    const prepared = await prepareWorkflowFreshLaunch({
      ctx: harness.ctx,
      input: freshInput(),
      targetWorkingDirectory: "/tmp/repo/custom-worktree",
      deps: harness.deps,
    });

    expect(harness.calls.ensureRuntime[0]?.[0]).toEqual({
      workspaceId: "workspace-1",
      targetWorkingDirectory: "/tmp/repo/custom-worktree",
      runtimeKind: "opencode",
    });
    expect(prepared.launch).toMatchObject({
      mode: "start",
      repoPath: REPO_PATH,
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
      selectedModel: freshInput().selectedModel,
    });
    expect(prepared.launch.systemPrompt).toContain("Implement feature");
    expect(prepared.bootstrap).toBeDefined();
    expect(harness.calls.stopSession).toHaveLength(0);
  });

  test("performs no runtime side effects when the task is missing", async () => {
    const harness = createHarness({ taskCards: [] });

    await expect(
      prepareWorkflowFreshLaunch({
        ctx: harness.ctx,
        input: freshInput(),
        targetWorkingDirectory: null,
        deps: harness.deps,
      }),
    ).rejects.toThrow("Task not found: task-1");
    expect(harness.calls.ensureRuntime).toHaveLength(0);
  });

  test("performs no runtime side effects when the role is unavailable for the task", async () => {
    const harness = createHarness({ taskCards: [unavailableBuildTaskCard()] });

    await expect(
      prepareWorkflowFreshLaunch({
        ctx: harness.ctx,
        input: freshInput(),
        targetWorkingDirectory: null,
        deps: harness.deps,
      }),
    ).rejects.toThrow("Role 'build' is unavailable for task 'task-1'");
    expect(harness.calls.ensureRuntime).toHaveLength(0);
  });

  test("aborts the worktree bootstrap when preparation becomes stale after runtime resolution", async () => {
    const harness = createHarness();
    const originalEnsureRuntime = harness.deps.runtime.ensureRuntime;
    harness.deps.runtime.ensureRuntime = async (...args) => {
      const runtime = await originalEnsureRuntime(...args);
      harness.setStale();
      return runtime;
    };

    await expect(
      prepareWorkflowFreshLaunch({
        ctx: harness.ctx,
        input: freshInput(),
        targetWorkingDirectory: null,
        deps: harness.deps,
      }),
    ).rejects.toThrow(STALE_START_ERROR);
    expect(harness.calls.bootstrapAbort).toBe(1);
    expect(harness.calls.stopSession).toHaveLength(0);
  });
});

describe("prepareWorkflowForkLaunch", () => {
  test("resolves the source and prepares the fork launch", async () => {
    const harness = createHarness();
    const events: string[] = [];
    const originalReadSnapshot = harness.deps.session.readSessionSnapshot;
    harness.deps.session.readSessionSnapshot = (identity) => {
      events.push("source");
      return originalReadSnapshot(identity);
    };

    const prepared = await prepareWorkflowForkLaunch({
      ctx: harness.ctx,
      input: forkInput(),
      deps: harness.deps,
    });

    expect(events).toEqual(["source"]);
    expect(prepared.launch).toMatchObject({
      mode: "fork",
      repoPath: REPO_PATH,
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
      parentExternalSessionId: "source-session",
    });
    expect(prepared.launch.systemPrompt).toContain("Implement feature");
  });

  test("forwards holdForPostStartMessage into the prepared fork launch", async () => {
    const harness = createHarness();

    const prepared = await prepareWorkflowForkLaunch({
      ctx: { ...harness.ctx, holdForPostStartMessage: true },
      input: forkInput(),
      deps: harness.deps,
    });

    expect(prepared.launch.holdForPostStartMessage).toBe(true);
  });

  test("rejects when the source session cannot be resolved", async () => {
    const harness = createHarness({ sourceSessions: [] });

    await expect(
      prepareWorkflowForkLaunch({
        ctx: harness.ctx,
        input: forkInput(),
        deps: harness.deps,
      }),
    ).rejects.toThrow('Session "source-session" is not available');
  });

  test("rejects when a legacy repository-root session cannot be forked", async () => {
    const legacyRootSession = {
      ...workflowSourceSession(),
      workingDirectory: REPO_PATH,
    };
    const harness = createHarness({ sourceSessions: [legacyRootSession] });

    await expect(
      prepareWorkflowForkLaunch({
        ctx: harness.ctx,
        input: {
          ...forkInput(),
          sourceSession: {
            externalSessionId: "source-session",
            runtimeKind: "opencode",
            workingDirectory: REPO_PATH,
          },
        },
        deps: harness.deps,
      }),
    ).rejects.toThrow("legacy repository-root task session");
  });

  test("rejects when the selected model runtime does not match the source runtime", async () => {
    const harness = createHarness();

    await expect(
      prepareWorkflowForkLaunch({
        ctx: harness.ctx,
        input: {
          ...forkInput(),
          selectedModel: {
            runtimeKind: "codex",
            providerId: "openai",
            modelId: "gpt-5-codex",
          },
        },
        deps: harness.deps,
      }),
    ).rejects.toThrow('cannot be forked with runtime "codex"');
  });
});

describe("registerWorkflowSessionLaunch", () => {
  test("completes the bootstrap for the host-stored workflow session", async () => {
    const harness = createHarness();

    await registerWorkflowSessionLaunch(registrationInputFor(harness));

    expect(harness.calls.bootstrapComplete).toBe(1);
    expect(harness.calls.stopSession).toHaveLength(0);
  });

  test("attaches the session before bootstrap can publish newer live state", async () => {
    const harness = createHarness();
    const input = registrationInputFor(harness);
    let current: AgentSessionState = input.sessionState;
    harness.deps.session.replaceSession = (session) => {
      current = session;
    };
    input.bootstrap.complete = async () => {
      current = {
        ...current,
        livePresence: "present",
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [
              {
                header: "Choice",
                question: "Continue?",
                options: [{ label: "Yes", description: "Continue." }],
                multiple: false,
                custom: false,
              },
            ],
          },
        ],
      };
    };

    await registerWorkflowSessionLaunch(input);

    expect(current.livePresence).toBe("present");
    expect(current.pendingQuestions).toHaveLength(1);
  });

  test("keeps the stored session when bootstrap completion fails", async () => {
    const harness = createHarness();
    const registrationInput = registrationInputFor(harness);
    registrationInput.bootstrap.complete = async () => {
      throw new Error("bootstrap completion failed");
    };

    await expect(registerWorkflowSessionLaunch(registrationInput)).rejects.toThrow(
      "bootstrap completion failed",
    );
    expect(harness.calls.stopSession).toEqual(["external-commit"]);
    expect(harness.calls.bootstrapAbort).toBe(0);
  });

  test("cleans up the session while preserving committed resources when stale after bootstrap commits", async () => {
    const harness = createHarness();
    const registrationInput = registrationInputFor(harness);
    const originalComplete = registrationInput.bootstrap.complete;
    registrationInput.bootstrap.complete = async () => {
      await originalComplete();
      harness.setStale();
    };

    await expect(registerWorkflowSessionLaunch(registrationInput)).rejects.toThrow(
      "Workspace changed while starting session.",
    );
    expect(harness.calls.stopSession).toEqual(["external-commit"]);
    expect(harness.calls.bootstrapAbort).toBe(0);
  });

  test("keeps the stored session and its worktree when stale before bootstrap completion", async () => {
    const harness = createHarness();
    harness.setStale();

    await expect(registerWorkflowSessionLaunch(registrationInputFor(harness))).rejects.toThrow(
      STALE_START_ERROR,
    );
    expect(harness.calls.stopSession).toEqual(["external-commit"]);
    expect(harness.calls.bootstrapAbort).toBe(0);
    expect(harness.calls.bootstrapComplete).toBe(1);
  });

  test("keeps rollback failure visible when cleanup cannot stop the session", async () => {
    const harness = createHarness();
    harness.setStale();
    harness.deps.runtime.adapter.stopSession = async () => {
      throw new Error("runtime unavailable");
    };

    await expect(registerWorkflowSessionLaunch(registrationInputFor(harness))).rejects.toThrow(
      "Workspace changed while starting session. Failed to stop the started session during rollback: runtime unavailable. Cleanup was not continued.",
    );
    expect(harness.calls.bootstrapComplete).toBe(1);
    expect(harness.calls.clearObservation).toHaveLength(0);
  });
});
