import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import { MISSING_BUILD_TARGET_ERROR } from "../operations/agent-orchestrator/handlers/start-session-constants";

const startSessionWorkflowMock = mock(async () => undefined);

let detectAutopilotEvents: typeof import("./autopilot-provider").detectAutopilotEvents;
let executeAutopilotAction: typeof import("./autopilot-provider").executeAutopilotAction;

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

const createExecuteArgs = (task: TaskCard) => ({
  repoPath: "/repo",
  task,
  queryClient: {} as QueryClient,
  loadRepoRuntimeCatalog: mock(async () => {
    throw new Error("loadRepoRuntimeCatalog should not be called in this test");
  }),
  startAgentSession: mock(async () => {
    throw new Error("startAgentSession should not be called in this test");
  }),
  sendAgentMessage: mock(async () => {
    throw new Error("sendAgentMessage should not be called in this test");
  }),
});

describe("autopilot provider helpers", () => {
  beforeAll(async () => {
    mock.module("@/features/session-start/session-start-workflow", () => ({
      startSessionWorkflow: startSessionWorkflowMock,
    }));
    ({ detectAutopilotEvents, executeAutopilotAction } = await import("./autopilot-provider"));
  });

  beforeEach(() => {
    startSessionWorkflowMock.mockReset();
    startSessionWorkflowMock.mockImplementation(async () => undefined);
  });

  afterAll(() => {
    mock.restore();
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
    startSessionWorkflowMock.mockImplementationOnce(async () => {
      throw new Error(MISSING_BUILD_TARGET_ERROR);
    });

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
});
