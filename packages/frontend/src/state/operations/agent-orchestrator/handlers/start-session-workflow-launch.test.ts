import { describe, expect, test } from "bun:test";
import type { AgentEnginePort, AgentSessionSummary } from "@openducktor/core";
import { createSessionStartGate } from "@/features/session-start/session-start-gate";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "../support/messages";
import { createTaskCardFixture } from "../test-utils";
import type { StartSessionContext, StartSessionExecutionDependencies } from "./start-session.types";
import { STALE_START_ERROR } from "./start-session-constants";
import {
  prepareWorkflowForkLaunch,
  prepareWorkflowFreshLaunch,
  registerWorkflowSessionLaunch,
} from "./start-session-workflow-launch";

const REPO_PATH = "/tmp/repo";

const context = (isStaleRepoOperation = () => false): StartSessionContext => ({
  repoPath: REPO_PATH,
  workspaceId: "workspace-1",
  taskId: "task-1",
  role: "build",
  holdForPostStartMessage: false,
  isStaleRepoOperation,
});

const sourceSession = (): AgentSessionState => ({
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

const createDependencies = (calls: string[]): StartSessionExecutionDependencies => {
  const source = sourceSession();
  const stopAdapter: Pick<AgentEnginePort, "stopSession"> = {
    stopSession: async (input) => {
      calls.push(`stop:${input.externalSessionId}`);
    },
  };
  // SAFETY: This test seam calls only stopSession, which the object implements above.
  const adapter = stopAdapter as AgentEnginePort;
  return {
    session: {
      replaceSession: (session) => calls.push(`attach:${session.externalSessionId}`),
      readSessionSnapshot: (identity) =>
        identity.externalSessionId === source.externalSessionId ? source : null,
      sessionStartGateRef: { current: createSessionStartGate() },
      loadSourceSession: async ({ sourceSession: identity }) =>
        identity.externalSessionId === source.externalSessionId ? source : null,
      loadAgentSessionHistory: async () => null,
      clearSessionObservationState: () => undefined,
    },
    runtime: {
      adapter,
      canonicalizePath: async (path) => path,
      startWorkflowSession: async () => {
        throw new Error("fresh launch preparation must not start the runtime");
      },
    },
    task: {
      taskRef: {
        current: [createTaskCardFixture({ id: "task-1", title: "Implement feature" })],
      },
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      refreshSessionRecords: async () => {
        calls.push("refresh:sessions");
      },
      refreshTaskData: async () => {
        calls.push("refresh:task");
      },
      sendAgentMessage: async () => undefined,
    },
    model: {
      loadRepoPromptOverrides: async () => ({}),
      loadSettingsSnapshot: async () => createSettingsSnapshotFixture(),
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
      profileId: "build",
    },
  }) as const;

const registrationInput = (
  deps: StartSessionExecutionDependencies,
  calls: string[],
  isStaleOperation = () => false,
) => {
  const summary: AgentSessionSummary = {
    externalSessionId: "session-1",
    runtimeKind: "opencode",
    workingDirectory: "/tmp/repo/worktree",
    startedAt: "2026-08-21T10:00:00.000Z",
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
    status: "idle",
  };
  const identity: AgentSessionIdentity = {
    externalSessionId: summary.externalSessionId,
    runtimeKind: summary.runtimeKind,
    workingDirectory: summary.workingDirectory,
  };
  const sessionState: AgentSessionState = {
    ...sourceSession(),
    externalSessionId: summary.externalSessionId,
    startedAt: summary.startedAt,
  };
  deps.session.replaceSession = (session) => calls.push(`attach:${session.externalSessionId}`);
  return {
    summary,
    identity,
    sessionState,
    isStaleOperation,
    ctx: context(isStaleOperation),
    deps: { session: deps.session, runtime: deps.runtime, task: deps.task },
  };
};

describe("prepareWorkflowFreshLaunch", () => {
  test("prepares one host-owned workflow start request", async () => {
    const calls: string[] = [];
    const prepared = await prepareWorkflowFreshLaunch({
      ctx: context(),
      input: freshInput(),
      targetWorkingDirectory: "/tmp/repo/custom-worktree",
      deps: createDependencies(calls),
    });

    expect(prepared.launch).toMatchObject({
      mode: "start",
      repoPath: REPO_PATH,
      runtimeKind: "opencode",
      targetWorkingDirectory: "/tmp/repo/custom-worktree",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
      selectedModel: freshInput().selectedModel,
    });
    expect(prepared.launch).not.toHaveProperty("workingDirectory");
    expect(prepared.launch.systemPrompt).toContain("Implement feature");
    expect(calls).toEqual([]);
  });

  test("fails before host startup when the task is missing", async () => {
    const deps = createDependencies([]);
    deps.task.taskRef.current = [];

    await expect(
      prepareWorkflowFreshLaunch({
        ctx: context(),
        input: freshInput(),
        targetWorkingDirectory: null,
        deps,
      }),
    ).rejects.toThrow("Task not found: task-1");
  });
});

describe("prepareWorkflowForkLaunch", () => {
  test("keeps fork startup on the existing worktree path", async () => {
    const prepared = await prepareWorkflowForkLaunch({
      ctx: context(),
      input: {
        ...freshInput(),
        startMode: "fork",
        sourceSession: {
          externalSessionId: "source-session",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        },
      },
      deps: createDependencies([]),
    });

    expect(prepared.launch).toMatchObject({
      mode: "fork",
      workingDirectory: "/tmp/repo/worktree",
      parentExternalSessionId: "source-session",
    });
  });
});

describe("registerWorkflowSessionLaunch", () => {
  test("refreshes stored data before it attaches the session", async () => {
    const calls: string[] = [];
    const deps = createDependencies(calls);

    await registerWorkflowSessionLaunch(registrationInput(deps, calls));

    expect(calls).toEqual(["refresh:sessions", "refresh:task", "attach:session-1"]);
  });

  test("stops the stored session when the workspace became stale", async () => {
    const calls: string[] = [];
    const deps = createDependencies(calls);

    await expect(
      registerWorkflowSessionLaunch(registrationInput(deps, calls, () => true)),
    ).rejects.toThrow(STALE_START_ERROR);
    expect(calls).toContain("stop:session-1");
    expect(calls).not.toContain("attach:session-1");
  });
});
