import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentSessionRecord,
  RepositoryGitProviderContext,
  RepoConfig,
  TaskCard,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { AgentModelCatalog } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import { executeAutopilotAction } from "@/features/autopilot/autopilot-actions";
import {
  detectAutopilotEvents,
  shouldAdvanceAutopilotBaseline,
} from "@/features/autopilot/autopilot-events";
import {
  createSessionStartWorkflowRunner,
  type RunSessionStartWorkflow,
} from "@/features/session-start";
import { createSessionStartGate } from "@/features/session-start/session-start-gate";
import type { SessionStartWorkflowResult } from "@/features/session-start/session-start-workflow";
import { MISSING_BUILD_TARGET_ERROR } from "@/lib/session-start-errors";
import { createStartSessionTestHarness } from "@/state/operations/agent-orchestrator/handlers/start-session.test-helpers";
import { withTimeout } from "@/state/operations/agent-orchestrator/test-utils";
import {
  repoConfigQueryOptions,
  settingsSnapshotQueryOptions,
  workspaceQueryKeys,
} from "@/state/queries/workspace";
import {
  createGitProviderContextFixture,
  createDeferred,
  createSettingsSnapshotFixture,
  createTaskCardFixture,
} from "@/test-utils/shared-test-fixtures";
import { repositoryGitProviderContextQueryOptions } from "@/state/queries/git-provider-context";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

const runSessionStartWorkflowMock = mock(
  async (_input: Parameters<RunSessionStartWorkflow>[0]): Promise<SessionStartWorkflowResult> => ({
    externalSessionId: "session-new",
    runtimeKind: "opencode" as const,
    workingDirectory: "/repo/worktrees/session-new",
    postStartActionError: null,
  }),
);

const createBuilderSessionRecord = (
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord => ({
  externalSessionId: "external-builder-session-1",
  role: "build",
  startedAt: "2026-02-22T10:00:00.000Z",
  runtimeKind: "opencode",
  workingDirectory: "/tmp/repo/worktree",
  selectedModel: {
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "gpt-5",
    variant: "high",
    profileId: "builder",
  },
  ...overrides,
});

const createTask = (overrides: Partial<TaskCard> = {}): TaskCard =>
  createTaskCardFixture({}, overrides);

const createRepoConfig = (): RepoConfig => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "opencode",
  worktreeBasePath: undefined,
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentStudioState: { openTaskIds: [] },
  agentDefaults: {
    spec: undefined,
    planner: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "planner",
    },
    build: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "builder",
    },
    qa: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "qa",
    },
  },
});

const createQueryClient = (): QueryClient => {
  const queryClient = new QueryClient();
  const workspace: WorkspaceRecord = {
    workspaceId: "repo",
    workspaceName: "Repo",
    repoPath: "/repo",
    isActive: true,
    hasConfig: true,
    configuredWorktreeBasePath: null,
    defaultWorktreeBasePath: "/worktrees/repo",
    effectiveWorktreeBasePath: "/worktrees/repo",
  };
  queryClient.setQueryData(workspaceQueryKeys.list(), [workspace]);
  queryClient.setQueryData(repoConfigQueryOptions("repo").queryKey, createRepoConfig());
  queryClient.setQueryData(
    repositoryGitProviderContextQueryOptions("/repo").queryKey,
    createGitProviderContextFixture(),
  );
  return queryClient;
};

const setGitProviderContext = (
  queryClient: QueryClient,
  context: RepositoryGitProviderContext,
): void => {
  queryClient.setQueryData(repositoryGitProviderContextQueryOptions("/repo").queryKey, context);
};

const createExecuteArgs = (task: TaskCard) => {
  const loadTaskSessionRecords = mock(async (): Promise<AgentSessionRecord[]> => []);

  return {
    activeWorkspace: {
      repoPath: "/repo",
      workspaceId: "repo",
      workspaceName: "Repo",
    },
    task,
    alwaysStartQaReviewsFresh: false,
    queryClient: createQueryClient(),
    loadTaskSessionRecords,
    loadRepoRuntimeCatalog: mock(async (): Promise<AgentModelCatalog> => ({
      models: [
        {
          id: "openai",
          providerId: "openai",
          providerName: "OpenAI",
          modelId: "gpt-5",
          modelName: "GPT-5",
          variants: ["high"],
        },
      ],
      defaultModelsByProvider: {
        openai: "gpt-5",
      },
      profiles: [{ id: "planner", label: "Planner", mode: "primary" }],
    })),
    loadRepoRuntimeSlashCommands: mock(async () => ({ commands: [] })),
    loadRepoRuntimeFileSearch: mock(async () => []),
    resolveTaskWorktree: mock(async (): Promise<{ workingDirectory: string } | null> => null),
    runSessionStartWorkflow: runSessionStartWorkflowMock,
  };
};

describe("autopilot feature helpers", () => {
  beforeEach(() => {
    runSessionStartWorkflowMock.mockReset();
    runSessionStartWorkflowMock.mockImplementation(async () => ({
      externalSessionId: "session-new",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/session-new",
      postStartActionError: null,
    }));
  });

  test("detects status transitions and canonical QA rejection", () => {
    const previousSpecTask = createTask({ id: "TASK-1", status: "open" });
    const currentSpecTask = createTask({ id: "TASK-1", status: "spec_ready" });
    const previousQaTask = createTask({
      id: "TASK-2",
      status: "in_progress",
      documentSummary: {
        spec: { has: false },
        plan: { has: false },
        qaReport: { has: true, verdict: "not_reviewed" },
      },
    });
    const currentQaTask = createTask({
      id: "TASK-2",
      status: "in_progress",
      documentSummary: {
        spec: { has: false },
        plan: { has: false },
        qaReport: { has: true, verdict: "rejected" },
      },
    });

    const observedEvents = detectAutopilotEvents(
      new Map([
        [previousSpecTask.id, previousSpecTask],
        [previousQaTask.id, previousQaTask],
      ]),
      [currentSpecTask, currentQaTask],
    );

    expect(observedEvents).toEqual([
      { eventId: "taskProgressedToSpecReady", task: currentSpecTask },
      { eventId: "taskRejectedByQa", task: currentQaTask },
    ]);
  });

  test("does not backfill or retrigger unchanged task states", () => {
    const currentTask = createTask({ id: "TASK-1", status: "spec_ready" });

    expect(detectAutopilotEvents(new Map(), [currentTask])).toEqual([]);
    expect(detectAutopilotEvents(new Map([[currentTask.id, currentTask]]), [currentTask])).toEqual(
      [],
    );
  });

  test("keeps the previous baseline when settings are unavailable and an event was observed", () => {
    const observedEvents = detectAutopilotEvents(
      new Map([["TASK-1", createTask({ id: "TASK-1", status: "open" })]]),
      [createTask({ id: "TASK-1", status: "spec_ready" })],
    );

    expect(
      shouldAdvanceAutopilotBaseline({
        observedEvents,
        hasAutopilotSettings: false,
      }),
    ).toBe(false);
  });

  test("advances the baseline immediately when no event was observed", () => {
    expect(
      shouldAdvanceAutopilotBaseline({
        observedEvents: [],
        hasAutopilotSettings: false,
      }),
    ).toBe(true);
  });

  test("detects a later re-entry into ai_review after leaving the state", () => {
    const previousTask = createTask({ id: "TASK-1", status: "human_review" });
    const currentTask = createTask({ id: "TASK-1", status: "ai_review" });

    expect(
      detectAutopilotEvents(new Map([[previousTask.id, previousTask]]), [currentTask]),
    ).toEqual([{ eventId: "taskProgressedToAiReview", task: currentTask }]);
  });

  test("maps spec_ready automation to the planner launch action", async () => {
    const args = createExecuteArgs(createTask({ id: "TASK-PLAN", status: "spec_ready" }));

    await executeAutopilotAction({
      ...args,
      actionId: "startPlanner",
    });

    expect(runSessionStartWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          taskId: "TASK-PLAN",
          role: "planner",
        }),
        decision: expect.objectContaining({
          startMode: "fresh",
        }),
      }),
    );
  });

  test("reports post-start action errors from the workflow result", async () => {
    const postStartError = new Error("kickoff failed");
    runSessionStartWorkflowMock.mockImplementationOnce(async () => ({
      externalSessionId: "session-new",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/session-new",
      postStartActionError: postStartError,
    }));
    const args = createExecuteArgs(createTask({ id: "TASK-PLAN", status: "spec_ready" }));

    const outcome = await executeAutopilotAction({
      ...args,
      actionId: "startPlanner",
    });

    expect(outcome).toEqual({
      kind: "started",
      message: "Started Start Planner for TASK-PLAN.",
      postStartActionError: postStartError,
    });
  });

  test("skips pull request generation when no builder session exists", async () => {
    const outcome = await executeAutopilotAction({
      ...createExecuteArgs(createTask({ id: "TASK-PR", status: "human_review" })),
      actionId: "startGeneratePullRequest",
    });

    expect(outcome).toEqual({
      kind: "skipped",
      message: 'No Builder session is available to fork for task "TASK-PR".',
    });
    expect(runSessionStartWorkflowMock).not.toHaveBeenCalled();
  });

  test("skips pull request generation when no provider supports Pull Requests", async () => {
    const args = createExecuteArgs(createTask({ id: "TASK-PR", status: "human_review" }));
    args.loadTaskSessionRecords.mockResolvedValue([createBuilderSessionRecord()]);
    setGitProviderContext(args.queryClient, null);

    const outcome = await executeAutopilotAction({
      ...args,
      actionId: "startGeneratePullRequest",
    });

    expect(outcome).toEqual({
      kind: "skipped",
      message: "The current Git provider does not support Pull Requests.",
    });
    expect(runSessionStartWorkflowMock).not.toHaveBeenCalled();
  });

  test("skips pull request generation with the provider health error", async () => {
    const args = createExecuteArgs(createTask({ id: "TASK-PR", status: "human_review" }));
    args.loadTaskSessionRecords.mockResolvedValue([createBuilderSessionRecord()]);
    setGitProviderContext(args.queryClient, createGitProviderContextFixture({ available: false }));

    const outcome = await executeAutopilotAction({
      ...args,
      actionId: "startGeneratePullRequest",
    });

    expect(outcome).toEqual({
      kind: "skipped",
      message: "Sign in to GitHub CLI.",
    });
    expect(runSessionStartWorkflowMock).not.toHaveBeenCalled();
  });

  test("skips pull request generation when the provider context read fails", async () => {
    const args = createExecuteArgs(createTask({ id: "TASK-PR", status: "human_review" }));
    args.queryClient.removeQueries({
      queryKey: repositoryGitProviderContextQueryOptions("/repo").queryKey,
    });

    const outcome = await executeAutopilotAction({
      ...args,
      actionId: "startGeneratePullRequest",
    });

    expect(outcome).toEqual({
      kind: "skipped",
      message:
        "Could not load the current Git provider: OpenDucktor shell bridge is not configured. Start through the desktop shell or @openducktor/web.",
    });
    expect(runSessionStartWorkflowMock).not.toHaveBeenCalled();
  });

  test("skips builder follow-up when the build continuation target is missing", async () => {
    const args = createExecuteArgs(createTask({ id: "TASK-QA", status: "in_progress" }));
    args.loadTaskSessionRecords.mockResolvedValue([createBuilderSessionRecord()]);

    const outcome = await executeAutopilotAction({
      ...args,
      actionId: "startReviewQaFeedbacks",
    });

    expect(outcome).toEqual({
      kind: "skipped",
      message: MISSING_BUILD_TARGET_ERROR,
    });
  });

  test("starts fresh QA when the canonical task worktree does not exist yet", async () => {
    const args = createExecuteArgs(createTask({ id: "TASK-QA", status: "ai_review" }));

    const outcome = await executeAutopilotAction({
      ...args,
      actionId: "startQa",
    });

    expect(outcome.kind).toBe("started");
    expect(runSessionStartWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.not.objectContaining({ targetWorkingDirectory: expect.anything() }),
        decision: expect.objectContaining({ startMode: "fresh" }),
      }),
    );
  });

  test("surfaces unexpected pull request start failures", async () => {
    runSessionStartWorkflowMock.mockImplementationOnce(async () => {
      throw new Error("workflow failed");
    });
    const args = createExecuteArgs(createTask({ id: "TASK-PR", status: "human_review" }));
    args.loadTaskSessionRecords.mockResolvedValue([createBuilderSessionRecord()]);

    await expect(
      executeAutopilotAction({
        ...args,
        actionId: "startGeneratePullRequest",
      }),
    ).rejects.toThrow("workflow failed");
  });

  test("falls back to a fresh builder continuation when the latest builder session targets an older worktree", async () => {
    const args = createExecuteArgs(createTask({ id: "TASK-QA", status: "in_progress" }));
    args.loadTaskSessionRecords.mockResolvedValue([
      createBuilderSessionRecord({ workingDirectory: "/tmp/repo/old-worktree" }),
    ]);
    args.resolveTaskWorktree.mockResolvedValue({
      workingDirectory: "/tmp/repo/new-worktree",
    });

    await executeAutopilotAction({
      ...args,
      actionId: "startReviewQaFeedbacks",
    });

    expect(runSessionStartWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          targetWorkingDirectory: "/tmp/repo/new-worktree",
        }),
        decision: expect.objectContaining({
          startMode: "fresh",
        }),
      }),
    );
  });

  test("reuses QA follow-up only when the latest QA session matches the current continuation target", async () => {
    const args = createExecuteArgs(createTask({ id: "TASK-QA", status: "ai_review" }));
    args.loadTaskSessionRecords.mockResolvedValue([
      createBuilderSessionRecord({
        externalSessionId: "qa-session-1",
        role: "qa",
        workingDirectory: "/tmp/repo/current-worktree",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "qa",
        },
      }),
    ]);
    args.resolveTaskWorktree.mockResolvedValue({
      workingDirectory: "/tmp/repo/current-worktree",
    });

    await executeAutopilotAction({
      ...args,
      actionId: "startQa",
    });

    expect(runSessionStartWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({
          startMode: "reuse",
          sourceSession: {
            externalSessionId: "qa-session-1",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo/current-worktree",
          },
        }),
      }),
    );
  });

  test("starts fresh QA without a source when the fresh-session setting is enabled", async () => {
    const args = createExecuteArgs(createTask({ id: "TASK-QA-FRESH", status: "ai_review" }));
    args.loadTaskSessionRecords.mockResolvedValue([
      createBuilderSessionRecord({
        externalSessionId: "qa-session-existing",
        role: "qa",
        workingDirectory: "/tmp/repo/current-worktree",
      }),
    ]);
    args.resolveTaskWorktree.mockResolvedValue({
      workingDirectory: "/tmp/repo/current-worktree",
    });

    await executeAutopilotAction({
      ...args,
      actionId: "startQa",
      alwaysStartQaReviewsFresh: true,
    });

    expect(args.loadTaskSessionRecords).not.toHaveBeenCalled();
    expect(runSessionStartWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          taskId: "TASK-QA-FRESH",
          role: "qa",
          launchActionId: "qa_review",
          postStartAction: "kickoff",
          targetWorkingDirectory: "/tmp/repo/current-worktree",
        }),
        decision: expect.objectContaining({
          startMode: "fresh",
          selectedModel: expect.objectContaining({
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
            variant: "high",
          }),
        }),
      }),
    );
    expect(runSessionStartWorkflowMock.mock.calls[0]?.[0].decision).not.toHaveProperty(
      "sourceSession",
    );
  });

  test("forces a fresh decision for each enabled QA invocation", async () => {
    const args = createExecuteArgs(createTask({ id: "TASK-QA-REPEAT", status: "ai_review" }));
    args.resolveTaskWorktree.mockResolvedValue({
      workingDirectory: "/tmp/repo/current-worktree",
    });

    await executeAutopilotAction({ ...args, actionId: "startQa", alwaysStartQaReviewsFresh: true });
    await executeAutopilotAction({ ...args, actionId: "startQa", alwaysStartQaReviewsFresh: true });

    expect(runSessionStartWorkflowMock).toHaveBeenCalledTimes(2);
    expect(
      runSessionStartWorkflowMock.mock.calls.every(
        ([input]) => input.decision.startMode === "fresh" && !("sourceSession" in input.decision),
      ),
    ).toBe(true);
  });

  test("starts the second distinct session before the first kickoff completes", async () => {
    const task = createTask({ id: "TASK-QA-OVERLAP", status: "ai_review" });
    task.agentWorkflows.qa.available = true;
    const args = createExecuteArgs(task);
    args.resolveTaskWorktree
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ workingDirectory: "/tmp/repo/current-worktree" });
    args.queryClient.setQueryData(
      settingsSnapshotQueryOptions().queryKey,
      createSettingsSnapshotFixture(),
    );

    const adapter = new OpencodeSdkAdapter();
    const releaseStarts = createDeferred<void>();
    const firstKickoffStarted = createDeferred<void>();
    const releaseFirstKickoff = createDeferred<void>();
    const secondSessionStarted = createDeferred<void>();
    const sessionStartGate = createSessionStartGate<AgentSessionIdentity>();
    let startCount = 0;
    const kickoffSessionIds: string[] = [];

    const { start } = createStartSessionTestHarness({
      adapter,
      taskRef: { current: [task] },
      sessionStartGateRef: { current: sessionStartGate },
      startWorkflowSession: async () => {
        startCount += 1;
        const sessionNumber = startCount;
        await releaseStarts.promise;
        if (sessionNumber === 2) {
          secondSessionStarted.resolve();
        }
        return {
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/current-worktree",
          externalSessionId: `qa-session-${sessionNumber}`,
          startedAt: `2026-08-31T10:00:0${sessionNumber}.000Z`,
          status: "idle",
        };
      },
    });
    const runSessionStartWorkflow = createSessionStartWorkflowRunner({
      queryClient: args.queryClient,
      workspaceId: "repo",
      startAgentSession: start,
      sendAgentMessage: async (session) => {
        kickoffSessionIds.push(session.externalSessionId);
        if (kickoffSessionIds.length === 1) {
          firstKickoffStarted.resolve();
          await releaseFirstKickoff.promise;
        }
      },
    });

    try {
      const firstStart = executeAutopilotAction({
        ...args,
        runSessionStartWorkflow,
        actionId: "startQa",
        alwaysStartQaReviewsFresh: true,
      });
      const secondStart = executeAutopilotAction({
        ...args,
        runSessionStartWorkflow,
        actionId: "startQa",
        alwaysStartQaReviewsFresh: true,
      });
      releaseStarts.resolve();
      await firstKickoffStarted.promise;
      const secondStartOutcome = await withTimeout(secondSessionStarted.promise, 500);
      releaseFirstKickoff.resolve();
      await Promise.all([firstStart, secondStart]);

      expect(secondStartOutcome).not.toBe("timeout");
      expect(args.resolveTaskWorktree).toHaveBeenCalledTimes(2);
      expect(startCount).toBe(2);
      expect(kickoffSessionIds).toHaveLength(2);
      expect(new Set(kickoffSessionIds)).toEqual(new Set(["qa-session-1", "qa-session-2"]));
    } finally {
      releaseStarts.resolve();
      releaseFirstKickoff.resolve();
    }
  });

  test("does not reuse an old QA session when fresh model resolution fails", async () => {
    const args = createExecuteArgs(createTask({ id: "TASK-QA-FAIL", status: "ai_review" }));
    args.loadTaskSessionRecords.mockResolvedValue([
      createBuilderSessionRecord({
        externalSessionId: "qa-session-existing",
        role: "qa",
        workingDirectory: "/tmp/repo/current-worktree",
      }),
    ]);
    args.resolveTaskWorktree.mockResolvedValue({
      workingDirectory: "/tmp/repo/current-worktree",
    });
    args.loadRepoRuntimeCatalog.mockRejectedValue(new Error("catalog failed"));

    await expect(
      executeAutopilotAction({
        ...args,
        actionId: "startQa",
        alwaysStartQaReviewsFresh: true,
      }),
    ).rejects.toThrow("catalog failed");

    expect(args.loadTaskSessionRecords).not.toHaveBeenCalled();
    expect(runSessionStartWorkflowMock).not.toHaveBeenCalled();
  });

  test("does not force fresh starts for non-QA actions", async () => {
    const args = createExecuteArgs(createTask({ id: "TASK-BUILD", status: "in_progress" }));
    args.loadTaskSessionRecords.mockResolvedValue([
      createBuilderSessionRecord({ workingDirectory: "/tmp/repo/current-worktree" }),
    ]);
    args.resolveTaskWorktree.mockResolvedValue({
      workingDirectory: "/tmp/repo/current-worktree",
    });

    await executeAutopilotAction({
      ...args,
      actionId: "startReviewQaFeedbacks",
      alwaysStartQaReviewsFresh: true,
    });

    expect(runSessionStartWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({ decision: expect.objectContaining({ startMode: "reuse" }) }),
    );
  });

  test("does not resolve a model selection when autopilot reuses a matching session", async () => {
    const codexSelection = {
      runtimeKind: "codex" as const,
      providerId: "codex",
      modelId: "gpt-5",
      variant: "medium",
    };
    const args = createExecuteArgs(createTask({ id: "TASK-CODEX", status: "in_progress" }));
    args.loadTaskSessionRecords.mockResolvedValue([
      createBuilderSessionRecord({
        externalSessionId: "codex-builder-session-1",
        runtimeKind: "codex",
        workingDirectory: "/tmp/repo/current-worktree",
        selectedModel: codexSelection,
      }),
    ]);
    args.resolveTaskWorktree.mockResolvedValue({
      workingDirectory: "/tmp/repo/current-worktree",
    });

    await executeAutopilotAction({
      ...args,
      actionId: "startReviewQaFeedbacks",
    });

    expect(runSessionStartWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({
          startMode: "reuse",
          sourceSession: {
            externalSessionId: "codex-builder-session-1",
            runtimeKind: "codex",
            workingDirectory: "/tmp/repo/current-worktree",
          },
        }),
      }),
    );
  });
});
