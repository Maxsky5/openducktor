import { describe, expect, test } from "bun:test";
import type { AgentEnginePort, AgentSessionSummary } from "@openducktor/core";
import {
  emptyAgentSessionCollection,
  listAgentSessions,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import {
  buildLaunchedSessionState,
  createExecutePreparedSessionLaunch,
  type ExecutePreparedSessionLaunchInput,
  type PreparedSessionRegistrationInput,
  type SessionLaunchExecutorDependencies,
} from "./session-launch-executor";
import type { PreparedSessionLaunch } from "./prepared-session-launch";

const REPO_PATH = "/tmp/repo";

type ExecutorHarnessCalls = {
  startSession: Array<[Parameters<AgentEnginePort["startSession"]>[0]]>;
  resumeSession: Array<[Parameters<AgentEnginePort["resumeSession"]>[0]]>;
  forkSession: Array<[Parameters<AgentEnginePort["forkSession"]>[0]]>;
  stopSession: Array<[Parameters<AgentEnginePort["stopSession"]>[0]]>;
  releaseSession: Array<[Parameters<AgentEnginePort["releaseSession"]>[0]]>;
  loadSessionHistory: Array<[Parameters<AgentEnginePort["loadSessionHistory"]>[0]]>;
  replaceSession: AgentSessionState[];
  removeSession: AgentSessionIdentity[];
};

const summaryFor = (
  externalSessionId: string,
  sessionScope: AgentSessionSummary["sessionAssociation"],
  runtimeKind: PreparedSessionLaunch["runtimeKind"],
  workingDirectory: string,
): AgentSessionSummary => ({
  runtimeKind,
  workingDirectory,
  externalSessionId,
  startedAt: "2026-08-21T10:00:00.000Z",
  sessionAssociation: sessionScope,
  status: "idle",
});

const summaryFromRuntimeInput = (
  externalSessionId: string,
  input: {
    sessionScope: AgentSessionSummary["sessionAssociation"];
    runtimeKind: PreparedSessionLaunch["runtimeKind"];
    workingDirectory: string;
  },
): AgentSessionSummary =>
  summaryFor(externalSessionId, input.sessionScope, input.runtimeKind, input.workingDirectory);

const createExecutorHarness = () => {
  const sessionsRef = { current: emptyAgentSessionCollection() };
  const repoEpochRef = { current: 1 };
  const currentWorkspaceRepoPathRef = { current: REPO_PATH };
  const calls: ExecutorHarnessCalls = {
    startSession: [],
    resumeSession: [],
    forkSession: [],
    stopSession: [],
    releaseSession: [],
    loadSessionHistory: [],
    replaceSession: [],
    removeSession: [],
  };

  const adapter = {
    startSession: async (input: Parameters<AgentEnginePort["startSession"]>[0]) => {
      calls.startSession.push([input]);
      return summaryFromRuntimeInput(`started-${calls.startSession.length}`, input);
    },
    resumeSession: async (input: Parameters<AgentEnginePort["resumeSession"]>[0]) => {
      calls.resumeSession.push([input]);
      return summaryFromRuntimeInput(input.externalSessionId, input);
    },
    forkSession: async (input: Parameters<AgentEnginePort["forkSession"]>[0]) => {
      calls.forkSession.push([input]);
      return summaryFromRuntimeInput(`forked-${calls.forkSession.length}`, input);
    },
    stopSession: async (input: Parameters<AgentEnginePort["stopSession"]>[0]) => {
      calls.stopSession.push([input]);
    },
    releaseSession: async (input: Parameters<AgentEnginePort["releaseSession"]>[0]) => {
      calls.releaseSession.push([input]);
    },
    loadSessionHistory: async (input: Parameters<AgentEnginePort["loadSessionHistory"]>[0]) => {
      calls.loadSessionHistory.push([input]);
      return [];
    },
  } satisfies SessionLaunchExecutorDependencies["adapter"];

  const deps: SessionLaunchExecutorDependencies & {
    replaceSession: (session: AgentSessionState) => void;
    removeSession: (identity: AgentSessionIdentity) => void;
  } = {
    adapter,
    startWorkflowSession: async (input) =>
      adapter.startSession({
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
        workingDirectory: input.targetWorkingDirectory ?? "/tmp/repo/worktree",
        sessionScope: input.sessionScope,
        systemPrompt: input.systemPrompt,
        model: input.model,
      }),
    replaceSession: (session) => {
      calls.replaceSession.push(session);
      sessionsRef.current = replaceAgentSession(sessionsRef.current, session);
    },
    removeSession: (identity) => {
      calls.removeSession.push(identity);
    },
    loadSettingsSnapshot: async () => createSettingsSnapshotFixture(),
    repoEpochRef,
    currentWorkspaceRepoPathRef,
  };

  const executePrepared = createExecutePreparedSessionLaunch(deps);
  const registerLocally = async ({
    sessionState,
  }: PreparedSessionRegistrationInput): Promise<void> => {
    deps.replaceSession(sessionState);
  };
  const execute = (
    input: Omit<ExecutePreparedSessionLaunchInput, "register" | "rollback"> &
      Partial<Pick<ExecutePreparedSessionLaunchInput, "register" | "rollback">>,
  ) => {
    const rollback: ExecutePreparedSessionLaunchInput["rollback"] = async (rollbackInput) => {
      const sessionRef = {
        repoPath: input.launch.repoPath,
        ...rollbackInput.identity,
      };
      try {
        if (input.launch.mode === "resume") {
          await deps.adapter.releaseSession(sessionRef);
        } else {
          await deps.adapter.stopSession(sessionRef);
        }
      } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        throw new Error(
          `${rollbackInput.message} Failed to stop stale started session '${rollbackInput.identity.externalSessionId}': ${cause}`,
        );
      }
      try {
        deps.removeSession(rollbackInput.identity);
      } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        throw new Error(
          `${rollbackInput.message} The stale started session '${rollbackInput.identity.externalSessionId}' was finalized but its local registration could not be removed: ${cause}`,
        );
      }
      throw new Error(rollbackInput.message, { cause: rollbackInput.cause });
    };
    return executePrepared({
      ...input,
      register: input.register ?? registerLocally,
      rollback: input.rollback ?? rollback,
    });
  };

  return { calls, deps, execute, repoEpochRef, currentWorkspaceRepoPathRef, sessionsRef };
};

const repositoryStartLaunch = (): Extract<
  PreparedSessionLaunch,
  { mode: "start"; workingDirectory: string }
> => ({
  mode: "start",
  repoPath: REPO_PATH,
  runtimeKind: "opencode",
  workingDirectory: "/tmp/repo",
  sessionAssociation: { kind: "repository" },
  systemPrompt: "Repository chat prompt",
  selectedModel: {
    runtimeKind: "opencode",
    providerId: "anthropic",
    modelId: "claude-opus-4",
    variant: "thinking",
    profileId: "profile-1",
  },
});

const WORKFLOW_MODEL = {
  runtimeKind: "opencode" as const,
  providerId: "openai",
  modelId: "gpt-5",
};

const workflowStartLaunch = (): PreparedSessionLaunch => ({
  mode: "start",
  repoPath: REPO_PATH,
  runtimeKind: "opencode",
  sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
  systemPrompt: "Workflow prompt",
  selectedModel: WORKFLOW_MODEL,
});

describe("session-launch-executor", () => {
  test("starts a repository-associated session with exact association forwarding and no task data", async () => {
    const harness = createExecutorHarness();
    const launch = repositoryStartLaunch();

    const result = await harness.execute({ launch });

    expect(result.sessionAssociation).toEqual({ kind: "repository" });
    expect(result.summary).toMatchObject({
      externalSessionId: "started-1",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo",
    });
    expect(harness.calls.startSession[0]?.[0]).toMatchObject({
      repoPath: REPO_PATH,
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo",
      sessionScope: { kind: "repository" },
      systemPrompt: "Repository chat prompt",
      model: launch.selectedModel,
    });
    expect(harness.calls.replaceSession[0]?.sessionAssociation).toEqual({ kind: "repository" });
    expect(harness.calls.stopSession).toHaveLength(0);
    expect(harness.calls.removeSession).toHaveLength(0);
  });

  test("registers the launched session with the exact association and selected model", async () => {
    const harness = createExecutorHarness();
    const launch = workflowStartLaunch();

    const result = await harness.execute({ launch });

    const registered = harness.calls.replaceSession[0];
    expect(registered?.sessionAssociation).toEqual({
      kind: "workflow",
      taskId: "task-1",
      role: "build",
    });
    expect(registered?.selectedModel).toEqual(launch.selectedModel);
    expect(registered?.status).toBe("idle");
    expect(registered?.historyLoadState).toBe("loaded");
    expect(result.sessionAssociation).toEqual({
      kind: "workflow",
      taskId: "task-1",
      role: "build",
    });
  });

  test("resumes a repository-associated session through the same executor path", async () => {
    const harness = createExecutorHarness();
    const launch: PreparedSessionLaunch = {
      mode: "resume",
      repoPath: REPO_PATH,
      runtimeKind: "codex",
      workingDirectory: "/tmp/repo",
      sessionAssociation: { kind: "repository" },
      externalSessionId: "existing-session",
      selectedModel: {
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "gpt-5-codex",
      },
    };

    const result = await harness.execute({ launch });

    expect(harness.calls.resumeSession[0]?.[0]).toMatchObject({
      repoPath: REPO_PATH,
      runtimeKind: "codex",
      workingDirectory: "/tmp/repo",
      sessionScope: { kind: "repository" },
      externalSessionId: "existing-session",
      model: launch.selectedModel,
    });
    expect(result.summary.externalSessionId).toBe("existing-session");
    expect(harness.calls.replaceSession[0]?.externalSessionId).toBe("existing-session");
    expect(harness.calls.replaceSession[0]?.historyLoadState).toBe("not_requested");
    expect(harness.calls.loadSessionHistory).toHaveLength(0);
  });

  test("releases a resumed session instead of stopping it when the context becomes stale after launch", async () => {
    const harness = createExecutorHarness();
    const originalResume = harness.deps.adapter.resumeSession;
    harness.deps.adapter.resumeSession = async (input) => {
      const summary = await originalResume.call(harness.deps.adapter, input);
      harness.repoEpochRef.current += 1;
      return summary;
    };
    const launch: PreparedSessionLaunch = {
      mode: "resume",
      repoPath: REPO_PATH,
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo",
      sessionAssociation: { kind: "repository" },
      externalSessionId: "existing-session",
    };

    await expect(harness.execute({ launch })).rejects.toThrow(
      "Workspace changed while starting session.",
    );
    expect(harness.calls.releaseSession).toHaveLength(1);
    expect(harness.calls.stopSession).toHaveLength(0);
  });

  test("preserves the runtime-reported status when resuming a session", async () => {
    const harness = createExecutorHarness();
    const originalResume = harness.deps.adapter.resumeSession;
    harness.deps.adapter.resumeSession = async (input) => ({
      ...(await originalResume.call(harness.deps.adapter, input)),
      status: "running",
    });
    const launch: PreparedSessionLaunch = {
      mode: "resume",
      repoPath: REPO_PATH,
      runtimeKind: "codex",
      workingDirectory: "/tmp/repo",
      sessionAssociation: { kind: "repository" },
      externalSessionId: "existing-session",
    };

    await harness.execute({ launch });

    expect(harness.calls.replaceSession[0]?.status).toBe("running");
  });

  test("leaves resumed-session cleanup with the required registration owner", async () => {
    const harness = createExecutorHarness();
    const launch: PreparedSessionLaunch = {
      mode: "resume",
      repoPath: REPO_PATH,
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo",
      sessionAssociation: { kind: "repository" },
      externalSessionId: "existing-session",
    };

    await expect(
      harness.execute({
        launch,
        register: async () => {
          throw new Error("registration failed");
        },
      }),
    ).rejects.toThrow("registration failed");
    expect(harness.calls.releaseSession).toHaveLength(0);
    expect(harness.calls.stopSession).toHaveLength(0);
    expect(harness.calls.removeSession).toHaveLength(0);
  });

  test("does not seed a system prompt header for a resume without a prompt", async () => {
    const harness = createExecutorHarness();
    const launch: PreparedSessionLaunch = {
      mode: "resume",
      repoPath: REPO_PATH,
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo",
      sessionAssociation: { kind: "repository" },
      externalSessionId: "existing-session",
    };

    await harness.execute({ launch });

    const registered = harness.calls.replaceSession[0];
    expect(registered?.messages.items.some((message) => message.role === "system")).toBe(false);
  });

  test("resumes a workflow-associated session with the exact association forwarded", async () => {
    const harness = createExecutorHarness();
    const claudeModel = {
      runtimeKind: "claude" as const,
      providerId: "anthropic",
      modelId: "claude-opus-4",
      variant: "thinking",
      profileId: "planner-profile",
    };
    const launch: PreparedSessionLaunch = {
      mode: "resume",
      repoPath: REPO_PATH,
      runtimeKind: "claude",
      workingDirectory: "/tmp/repo/worktree",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "planner" },
      externalSessionId: "workflow-resume-target",
      systemPrompt: "Workflow resume prompt",
      selectedModel: claudeModel,
    };

    const result = await harness.execute({ launch });

    expect(harness.calls.resumeSession[0]?.[0]).toMatchObject({
      repoPath: REPO_PATH,
      runtimeKind: "claude",
      workingDirectory: "/tmp/repo/worktree",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "planner" },
      externalSessionId: "workflow-resume-target",
      systemPrompt: "Workflow resume prompt",
      model: claudeModel,
    });
    expect(result.sessionAssociation).toEqual({
      kind: "workflow",
      taskId: "task-1",
      role: "planner",
    });
    expect(harness.calls.replaceSession[0]?.sessionAssociation).toEqual({
      kind: "workflow",
      taskId: "task-1",
      role: "planner",
    });
  });

  test("forks with parent identity, prefetches child history, and seeds transcript messages", async () => {
    const harness = createExecutorHarness();
    const launch: PreparedSessionLaunch = {
      mode: "fork",
      repoPath: REPO_PATH,
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
      systemPrompt: "Fork prompt",
      parentExternalSessionId: "parent-session",
      selectedModel: WORKFLOW_MODEL,
    };

    const result = await harness.execute({ launch });

    expect(harness.calls.forkSession[0]?.[0]).toMatchObject({
      repoPath: REPO_PATH,
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      systemPrompt: "Fork prompt",
      parentExternalSessionId: "parent-session",
    });
    expect(harness.calls.loadSessionHistory).toHaveLength(1);
    expect(harness.calls.loadSessionHistory[0]?.[0]).toMatchObject({ limit: 600 });
    expect(result.summary.externalSessionId).toBe("forked-1");
  });

  test("forks a repository-associated session through the same executor path", async () => {
    const harness = createExecutorHarness();
    const launch: PreparedSessionLaunch = {
      mode: "fork",
      repoPath: REPO_PATH,
      runtimeKind: "claude",
      workingDirectory: "/tmp/repo/worktree",
      sessionAssociation: { kind: "repository" },
      systemPrompt: "Repository fork prompt",
      parentExternalSessionId: "repo-parent",
      selectedModel: {
        runtimeKind: "claude",
        providerId: "anthropic",
        modelId: "claude-opus-4",
        variant: "thinking",
        profileId: "build-profile",
      },
    };

    const result = await harness.execute({ launch });

    expect(harness.calls.forkSession[0]?.[0]).toMatchObject({
      repoPath: REPO_PATH,
      runtimeKind: "claude",
      workingDirectory: "/tmp/repo/worktree",
      sessionScope: { kind: "repository" },
      systemPrompt: "Repository fork prompt",
      parentExternalSessionId: "repo-parent",
      model: launch.selectedModel,
    });
    expect(result.sessionAssociation).toEqual({ kind: "repository" });
    expect(harness.calls.replaceSession[0]?.sessionAssociation).toEqual({ kind: "repository" });
    expect(harness.calls.loadSessionHistory).toHaveLength(1);
  });

  test("preserves Claude model profileId and variant into runtime call and local state", async () => {
    const harness = createExecutorHarness();
    const claudeModel = {
      runtimeKind: "claude" as const,
      providerId: "anthropic",
      modelId: "claude-opus-4",
      variant: "thinking",
      profileId: "build-profile",
    };
    const launch: PreparedSessionLaunch = {
      mode: "start",
      repoPath: REPO_PATH,
      runtimeKind: "claude",
      workingDirectory: "/tmp/repo",
      sessionAssociation: { kind: "repository" },
      systemPrompt: "Claude prompt",
      selectedModel: claudeModel,
    };

    await harness.execute({ launch });

    expect(harness.calls.startSession[0]?.[0]).toMatchObject({
      runtimeKind: "claude",
      model: claudeModel,
    });
    expect(harness.calls.replaceSession[0]?.selectedModel).toEqual(claudeModel);
  });

  test("runs codex launches through the same executor contract without runtime-kind switching", async () => {
    const harness = createExecutorHarness();
    const launch: PreparedSessionLaunch = {
      mode: "start",
      repoPath: REPO_PATH,
      runtimeKind: "codex",
      workingDirectory: "/tmp/repo",
      sessionAssociation: { kind: "repository" },
      systemPrompt: "Codex prompt",
      selectedModel: {
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "gpt-5-codex",
      },
    };

    const result = await harness.execute({ launch });

    expect(harness.calls.startSession[0]?.[0]).toMatchObject({
      runtimeKind: "codex",
      sessionScope: { kind: "repository" },
    });
    expect(result.sessionAssociation).toEqual({ kind: "repository" });
  });

  test("throws before any runtime or local side effect when the workspace repo path changed", async () => {
    const harness = createExecutorHarness();
    harness.currentWorkspaceRepoPathRef.current = "/tmp/other";

    await expect(harness.execute({ launch: repositoryStartLaunch() })).rejects.toThrow(
      "Workspace changed while starting session.",
    );
    expect(harness.calls.startSession).toHaveLength(0);
    expect(harness.calls.replaceSession).toHaveLength(0);
  });

  test("stops the launched runtime session when the context becomes stale after launch", async () => {
    const harness = createExecutorHarness();
    const originalStart = harness.deps.adapter.startSession;
    harness.deps.adapter.startSession = async (input) => {
      harness.repoEpochRef.current += 1;
      return originalStart.call(harness.deps.adapter, input);
    };

    await expect(harness.execute({ launch: repositoryStartLaunch() })).rejects.toThrow(
      "Workspace changed while starting session.",
    );
    expect(harness.calls.stopSession).toHaveLength(1);
    expect(harness.calls.stopSession[0]?.[0]).toMatchObject({
      repoPath: REPO_PATH,
      externalSessionId: "started-1",
    });
    expect(harness.calls.replaceSession).toHaveLength(0);
  });

  test("removes the local registration when the context becomes stale after registration", async () => {
    const harness = createExecutorHarness();
    const originalReplace = harness.deps.replaceSession;
    harness.deps.replaceSession = (session) => {
      originalReplace(session);
      harness.repoEpochRef.current += 1;
    };
    const launch: PreparedSessionLaunch = {
      ...repositoryStartLaunch(),
      mode: "fork",
      systemPrompt: "Fork prompt",
      parentExternalSessionId: "parent-session",
    };

    await expect(harness.execute({ launch })).rejects.toThrow(
      "Workspace changed while starting session.",
    );
    expect(harness.calls.removeSession).toHaveLength(1);
    expect(harness.calls.stopSession).toHaveLength(1);
  });

  test("keeps the local registration when stale cleanup cannot stop the runtime", async () => {
    const harness = createExecutorHarness();
    const originalReplace = harness.deps.replaceSession;
    harness.deps.replaceSession = (session) => {
      originalReplace(session);
      harness.repoEpochRef.current += 1;
    };
    harness.deps.adapter.stopSession = async () => {
      throw new Error("runtime unavailable");
    };

    await expect(harness.execute({ launch: repositoryStartLaunch() })).rejects.toThrow(
      "Failed to stop stale started session 'started-1': runtime unavailable",
    );
    expect(harness.calls.removeSession).toHaveLength(0);
  });

  test("keeps local removal failures visible after stale runtime cleanup", async () => {
    const harness = createExecutorHarness();
    const originalReplace = harness.deps.replaceSession;
    harness.deps.replaceSession = (session) => {
      originalReplace(session);
      harness.repoEpochRef.current += 1;
    };
    harness.deps.removeSession = () => {
      throw new Error("local removal failed");
    };

    await expect(harness.execute({ launch: repositoryStartLaunch() })).rejects.toThrow(
      "was finalized but its local registration could not be removed: local removal failed",
    );
    expect(harness.calls.stopSession).toHaveLength(1);
  });

  test("propagates runtime launch failures without registering a session", async () => {
    const harness = createExecutorHarness();
    harness.deps.adapter.startSession = async () => {
      throw new Error("runtime exploded");
    };

    await expect(harness.execute({ launch: repositoryStartLaunch() })).rejects.toThrow(
      "runtime exploded",
    );
    expect(harness.calls.replaceSession).toHaveLength(0);
    expect(harness.calls.stopSession).toHaveLength(0);
  });

  test("stops the launch before any side effect when only the caller context is stale", async () => {
    const harness = createExecutorHarness();

    await expect(
      harness.execute({
        launch: repositoryStartLaunch(),
        isCallerContextStale: () => true,
      }),
    ).rejects.toThrow("Workspace changed while starting session.");
    expect(harness.calls.startSession).toHaveLength(0);
    expect(harness.calls.replaceSession).toHaveLength(0);
  });

  test("stops the launched session when the caller context becomes stale after launch", async () => {
    const harness = createExecutorHarness();
    let callerContextStale = false;
    const originalStart = harness.deps.adapter.startSession;
    harness.deps.adapter.startSession = async (input) => {
      const summary = await originalStart.call(harness.deps.adapter, input);
      callerContextStale = true;
      return summary;
    };

    await expect(
      harness.execute({
        launch: repositoryStartLaunch(),
        isCallerContextStale: () => callerContextStale,
      }),
    ).rejects.toThrow("Workspace changed while starting session.");
    expect(harness.calls.stopSession).toHaveLength(1);
    expect(harness.calls.replaceSession).toHaveLength(0);
  });

  test("removes the local registration when the caller context becomes stale after registration", async () => {
    const harness = createExecutorHarness();
    let callerContextStale = false;
    const originalReplace = harness.deps.replaceSession;
    harness.deps.replaceSession = (session) => {
      originalReplace(session);
      callerContextStale = true;
    };

    await expect(
      harness.execute({
        launch: repositoryStartLaunch(),
        isCallerContextStale: () => callerContextStale,
      }),
    ).rejects.toThrow("Workspace changed while starting session.");
    expect(harness.calls.removeSession).toHaveLength(1);
    expect(harness.calls.stopSession).toHaveLength(1);
  });

  test("keeps registration ownership explicit and passes stale guard plus session state", async () => {
    const harness = createExecutorHarness();
    const registrationInputs: PreparedSessionRegistrationInput[] = [];

    await harness.execute({
      launch: repositoryStartLaunch(),
      register: async (input) => {
        registrationInputs.push(input);
      },
    });

    expect(registrationInputs).toHaveLength(1);
    const registrationInput = registrationInputs[0];
    expect(registrationInput).toBeDefined();
    if (!registrationInput) {
      throw new Error("Expected the launch registration callback to receive its input.");
    }
    expect(registrationInput.identity.externalSessionId).toBe("started-1");
    expect(registrationInput.sessionState.sessionAssociation).toEqual({ kind: "repository" });
    expect(registrationInput.isStaleOperation()).toBe(false);
  });

  test("leaves registration failure cleanup with the required registration owner", async () => {
    const harness = createExecutorHarness();

    await expect(
      harness.execute({
        launch: repositoryStartLaunch(),
        register: async () => {
          throw new Error("commit failed");
        },
      }),
    ).rejects.toThrow("commit failed");
    expect(harness.calls.stopSession).toHaveLength(0);
    expect(harness.calls.removeSession).toHaveLength(0);
    expect(listAgentSessions(harness.sessionsRef.current)).toHaveLength(0);
  });

  test("dispatches each launch mode through the matching runtime call", async () => {
    const harness = createExecutorHarness();

    await harness.execute({ launch: repositoryStartLaunch() });
    await harness.execute({
      launch: {
        mode: "resume",
        repoPath: REPO_PATH,
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
        sessionAssociation: { kind: "repository" },
        externalSessionId: "resume-target",
      },
    });
    await harness.execute({
      launch: {
        mode: "fork",
        repoPath: REPO_PATH,
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
        sessionAssociation: { kind: "repository" },
        systemPrompt: "prompt",
        parentExternalSessionId: "parent",
      },
    });

    expect(harness.calls.startSession).toHaveLength(1);
    expect(harness.calls.resumeSession).toHaveLength(1);
    expect(harness.calls.forkSession).toHaveLength(1);
  });
});

describe("buildLaunchedSessionState", () => {
  test("holds the session in starting state when post-start message is requested", () => {
    const launch: PreparedSessionLaunch = {
      ...repositoryStartLaunch(),
      holdForPostStartMessage: true,
    };
    const summary = summaryFor(
      "held-session",
      launch.sessionAssociation,
      launch.runtimeKind,
      launch.workingDirectory,
    );

    const state = buildLaunchedSessionState({ launch, summary });

    expect(state.status).toBe("starting");
    expect(state.historyLoadState).toBe("loaded");
  });

  test("seeds the system prompt header message for start launches", () => {
    const launch = repositoryStartLaunch();
    const summary = summaryFor(
      "header-session",
      launch.sessionAssociation,
      launch.runtimeKind,
      launch.workingDirectory,
    );

    const state = buildLaunchedSessionState({ launch, summary });

    expect(state.messages.items[0]).toMatchObject({
      role: "system",
      content: "System prompt:\n\nRepository chat prompt",
    });
  });
});
