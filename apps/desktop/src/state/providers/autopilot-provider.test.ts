import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord, RepoConfig, TaskCard } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import { repoConfigQueryOptions } from "@/state/queries/workspace";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import { MISSING_BUILD_TARGET_ERROR } from "../operations/agent-orchestrator/handlers/start-session-constants";
import {
  detectAutopilotEvents,
  executeAutopilotAction,
  shouldAdvanceAutopilotBaseline,
} from "./autopilot-provider";

const startSessionWorkflowMock = mock(async () => ({
  sessionId: "session-new",
  postStartActionError: null,
}));

const createBuilderSessionRecord = (
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord => ({
  sessionId: "builder-session-1",
  externalSessionId: "external-builder-session-1",
  role: "build",
  scenario: "build_implementation_start",
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
  defaultRuntimeKind: "opencode",
  worktreeBasePath: undefined,
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { providers: {} },
  trustedHooks: false,
  trustedHooksFingerprint: undefined,
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeFileCopies: [],
  promptOverrides: {},
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
  queryClient.setQueryData(repoConfigQueryOptions("/repo").queryKey, createRepoConfig());
  return queryClient;
};

const createExecuteArgs = (task: TaskCard) => ({
  repoPath: "/repo",
  task,
  queryClient: createQueryClient(),
  loadRepoRuntimeCatalog: mock(
    async (): Promise<AgentModelCatalog> => ({
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
    }),
  ),
  loadRepoRuntimeSlashCommands: mock(async () => ({ commands: [] })),
  resolveBuildContinuationTarget: mock(
    async (): Promise<{ workingDirectory: string } | null> => null,
  ),
  startSessionWorkflow: startSessionWorkflowMock,
  startAgentSession: mock(async () => {
    throw new Error("startAgentSession should not be called in this test");
  }),
  sendAgentMessage: mock(async () => {
    throw new Error("sendAgentMessage should not be called in this test");
  }),
});

describe("autopilot provider helpers", () => {
  beforeEach(() => {
    startSessionWorkflowMock.mockReset();
    startSessionWorkflowMock.mockImplementation(async () => ({
      sessionId: "session-new",
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

  test("maps spec_ready automation to the planner scenario", async () => {
    const args = createExecuteArgs(createTask({ id: "TASK-PLAN", status: "spec_ready" }));

    await executeAutopilotAction({
      ...args,
      actionId: "startPlanner",
    });

    expect(startSessionWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({
          taskId: "TASK-PLAN",
          role: "planner",
          scenario: "planner_initial",
          startMode: "fresh",
        }),
      }),
    );
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
    expect(startSessionWorkflowMock).not.toHaveBeenCalled();
  });

  test("skips builder follow-up when the build continuation target is missing", async () => {
    const outcome = await executeAutopilotAction({
      ...createExecuteArgs(
        createTask({
          id: "TASK-QA",
          status: "in_progress",
          agentSessions: [createBuilderSessionRecord()],
        }),
      ),
      actionId: "startReviewQaFeedbacks",
    });

    expect(outcome).toEqual({
      kind: "skipped",
      message: MISSING_BUILD_TARGET_ERROR,
    });
  });

  test("surfaces unexpected pull request start failures", async () => {
    startSessionWorkflowMock.mockImplementationOnce(async () => {
      throw new Error("workflow failed");
    });

    await expect(
      executeAutopilotAction({
        ...createExecuteArgs(
          createTask({
            id: "TASK-PR",
            status: "human_review",
            agentSessions: [createBuilderSessionRecord()],
          }),
        ),
        actionId: "startGeneratePullRequest",
      }),
    ).rejects.toThrow("workflow failed");
  });

  test("falls back to a fresh builder continuation when the latest builder session targets an older worktree", async () => {
    const args = createExecuteArgs(
      createTask({
        id: "TASK-QA",
        status: "in_progress",
        agentSessions: [createBuilderSessionRecord({ workingDirectory: "/tmp/repo/old-worktree" })],
      }),
    );
    args.resolveBuildContinuationTarget.mockResolvedValue({
      workingDirectory: "/tmp/repo/new-worktree",
    });

    await executeAutopilotAction({
      ...args,
      actionId: "startReviewQaFeedbacks",
    });

    expect(startSessionWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({
          startMode: "fresh",
          targetWorkingDirectory: "/tmp/repo/new-worktree",
        }),
      }),
    );
  });

  test("reuses QA follow-up only when the latest QA session matches the current continuation target", async () => {
    const args = createExecuteArgs(
      createTask({
        id: "TASK-QA",
        status: "ai_review",
        agentSessions: [
          createBuilderSessionRecord({
            sessionId: "qa-session-1",
            role: "qa",
            scenario: "qa_review",
            workingDirectory: "/tmp/repo/current-worktree",
            selectedModel: {
              runtimeKind: "opencode",
              providerId: "openai",
              modelId: "gpt-5",
              variant: "high",
              profileId: "qa",
            },
          }),
        ],
      }),
    );
    args.resolveBuildContinuationTarget.mockResolvedValue({
      workingDirectory: "/tmp/repo/current-worktree",
    });

    await executeAutopilotAction({
      ...args,
      actionId: "startQa",
    });

    expect(startSessionWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({
          startMode: "reuse",
          sourceSessionId: "qa-session-1",
        }),
        selection: null,
      }),
    );
  });
});
