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
  type SessionLaunchExecutorDependencies,
} from "./session-launch-executor";
import type { PreparedSessionLaunch } from "./prepared-session-launch";

const REPO_PATH = "/tmp/repo";

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
  const calls = {
    startSession: [] as unknown[][],
    resumeSession: [] as unknown[][],
    forkSession: [] as unknown[][],
    stopSession: [] as unknown[][],
    loadSessionHistory: [] as unknown[][],
    replaceSession: [] as AgentSessionState[],
    removeSession: [] as AgentSessionIdentity[],
  };

  const adapter = {
    startSession: async (input: unknown) => {
      calls.startSession.push([input]);
      return summaryFromRuntimeInput(`started-${calls.startSession.length}`, input as never);
    },
    resumeSession: async (input: unknown) => {
      calls.resumeSession.push([input]);
      return summaryFromRuntimeInput(
        (input as { externalSessionId: string }).externalSessionId,
        input as never,
      );
    },
    forkSession: async (input: unknown) => {
      calls.forkSession.push([input]);
      return summaryFromRuntimeInput(`forked-${calls.forkSession.length}`, input as never);
    },
    stopSession: async (input: unknown) => {
      calls.stopSession.push([input]);
    },
    loadSessionHistory: async (input: unknown) => {
      calls.loadSessionHistory.push([input]);
      return [];
    },
  } as unknown as AgentEnginePort;

  const deps: SessionLaunchExecutorDependencies = {
    adapter,
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

  const execute = createExecutePreparedSessionLaunch(deps);

  return { calls, deps, execute, repoEpochRef, currentWorkspaceRepoPathRef, sessionsRef };
};

const repositoryStartLaunch = (): PreparedSessionLaunch => ({
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
  workingDirectory: "/tmp/repo/worktree",
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
    expect(result.identity).toMatchObject({
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
    expect(result.summary.sessionAssociation).toEqual({
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
    expect(result.identity.externalSessionId).toBe("existing-session");
    expect(harness.calls.replaceSession[0]?.externalSessionId).toBe("existing-session");
    expect(harness.calls.loadSessionHistory).toHaveLength(0);
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
    expect(result.identity.externalSessionId).toBe("forked-1");
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

  test("throws before any runtime or local side effect when the caller context is stale", async () => {
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

  test("keeps commit ownership explicit and passes stale guard plus registered state", async () => {
    const harness = createExecutorHarness();
    const commitInputs: unknown[] = [];

    await harness.execute({
      launch: repositoryStartLaunch(),
      commit: async (input) => {
        commitInputs.push(input);
      },
    });

    expect(commitInputs).toHaveLength(1);
    const commitInput = commitInputs[0] as {
      identity: AgentSessionIdentity;
      sessionState: AgentSessionState;
      isStaleOperation: () => boolean;
    };
    expect(commitInput.identity.externalSessionId).toBe("started-1");
    expect(commitInput.sessionState.sessionAssociation).toEqual({ kind: "repository" });
    expect(commitInput.isStaleOperation()).toBe(false);
  });

  test("surfaces commit failures instead of masking them", async () => {
    const harness = createExecutorHarness();

    await expect(
      harness.execute({
        launch: repositoryStartLaunch(),
        commit: async () => {
          throw new Error("commit failed");
        },
      }),
    ).rejects.toThrow("commit failed");
    expect(harness.calls.stopSession).toHaveLength(0);
    expect(listAgentSessions(harness.sessionsRef.current)).toHaveLength(1);
  });

  test("does not read tasks, leases, worktrees, or task queries for any launch mode", async () => {
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
