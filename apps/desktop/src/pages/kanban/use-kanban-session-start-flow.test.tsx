import { describe, expect, mock, test } from "bun:test";
import { host } from "@/state/operations/shared/host";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  createAgentSessionFixture,
  createDeferred,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "../agents/agent-studio-test-utils";
import {
  resolveKanbanBuildStartScenario,
  useKanbanSessionStartFlow,
} from "./use-kanban-session-start-flow";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useKanbanSessionStartFlow>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useKanbanSessionStartFlow, initialProps);

const createBaseArgs = (): HookArgs => ({
  activeRepo: "/repo",
  repoSettings: null,
  tasks: [createTaskCardFixture({ id: "TASK-1", status: "human_review" })],
  sessions: [
    createAgentSessionFixture({
      sessionId: "builder-session-2",
      taskId: "TASK-1",
      role: "build",
      scenario: "build_after_qa_rejected",
      startedAt: "2026-03-20T12:00:00.000Z",
    }),
    createAgentSessionFixture({
      sessionId: "builder-session-1",
      taskId: "TASK-1",
      role: "build",
      scenario: "build_implementation_start",
      startedAt: "2026-03-19T12:00:00.000Z",
    }),
  ],
  navigate: mock(() => {}),
  loadRepoSettings: async () =>
    ({
      defaultRuntimeKind: "opencode",
      worktreeBasePath: ".worktrees",
      branchPrefix: "odt",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      trustedHooks: false,
      preStartHooks: [],
      postCompleteHooks: [],
      devServers: [],
      worktreeFileCopies: [],
      agentDefaults: {
        spec: null,
        planner: null,
        build: null,
        qa: null,
      },
    }) satisfies RepoSettingsInput,
  bootstrapTaskSessions: async () => {},
  hydrateRequestedTaskSessionHistory: async () => {},
  loadAgentSessions: async () => {},
  humanRequestChangesTask: async () => {},
  startAgentSession: async () => "session-new",
  sendAgentMessage: async () => {},
});

describe("resolveKanbanBuildStartScenario", () => {
  test("uses implementation start for regular build starts", () => {
    const task = createTaskCardFixture({ id: "TASK-1", status: "ready_for_dev" });

    expect(resolveKanbanBuildStartScenario([task], "TASK-1")).toBe("build_implementation_start");
  });

  test("uses QA rejection follow-up for QA-rejected tasks", () => {
    const task = createTaskCardFixture({ id: "TASK-1", status: "in_progress" });
    task.documentSummary.qaReport = {
      has: true,
      updatedAt: "2026-03-09T10:00:00.000Z",
      verdict: "rejected",
    };

    expect(resolveKanbanBuildStartScenario([task], "TASK-1")).toBe("build_after_qa_rejected");
  });

  test("uses human-feedback follow-up for human-review tasks", () => {
    const task = createTaskCardFixture({ id: "TASK-1", status: "human_review" });

    expect(resolveKanbanBuildStartScenario([task], "TASK-1")).toBe(
      "build_after_human_request_changes",
    );
  });
});

describe("useKanbanSessionStartFlow", () => {
  test("opens the shared session start modal for QA review", async () => {
    const args = createBaseArgs();
    args.tasks = [createTaskCardFixture({ id: "TASK-1", status: "ai_review" })];

    const harness = createHookHarness(args);

    await harness.mount();
    await harness.run((state) => {
      state.onQaStart("TASK-1");
    });

    const modal = harness.getLatest().sessionStartModal;
    expect(modal).not.toBeNull();
    expect(modal?.title).toBe("Start QA Session");
    expect(modal?.availableStartModes).toEqual(["fresh", "reuse"]);
    expect(modal?.selectedStartMode).toBe("fresh");
    expect(modal?.existingSessionOptions).toEqual([]);
    expect(modal?.description).toBe(
      "Choose how to start fresh or reuse an existing session for QA Review.",
    );

    await harness.unmount();
  });

  test("opens the shared session start modal for pull request generation as a fork-only builder flow", async () => {
    const harness = createHookHarness(createBaseArgs());

    await harness.mount();
    await harness.run(async (state) => {
      await state.onPullRequestGenerate("TASK-1");
    });

    const modal = harness.getLatest().sessionStartModal;
    expect(modal).not.toBeNull();
    expect(modal?.title).toBe("Start Builder Session");
    expect(modal?.availableStartModes).toEqual(["fork"]);
    expect(modal?.selectedStartMode).toBe("fork");
    expect(modal?.selectedSourceSessionId).toBe("builder-session-2");
    expect(modal?.existingSessionOptions).toEqual([
      expect.objectContaining({
        value: "builder-session-2",
        label: "Fix QA Rejection · Builder #2",
        description: "3/20/2026, 12:00:00 PM · idle · builder-",
        secondaryLabel: "Latest",
      }),
      expect.objectContaining({
        value: "builder-session-1",
        label: "Start Implementation · Builder #1",
        description: "3/19/2026, 12:00:00 PM · idle · builder-",
      }),
    ]);

    await harness.unmount();
  });

  test("reuse confirm does not wait for repo settings when the reused session has no saved model", async () => {
    const originalBuildContinuationTargetGet = host.buildContinuationTargetGet;
    const loadRepoSettings = mock(
      async () =>
        ({
          defaultRuntimeKind: "opencode",
          worktreeBasePath: ".worktrees",
          branchPrefix: "odt",
          defaultTargetBranch: { remote: "origin", branch: "main" },
          trustedHooks: false,
          preStartHooks: [],
          postCompleteHooks: [],
          devServers: [],
          worktreeFileCopies: [],
          agentDefaults: {
            spec: null,
            planner: null,
            build: null,
            qa: null,
          },
        }) satisfies RepoSettingsInput,
    );
    const startSessionDeferred = createDeferred<string>();
    const startAgentSession = mock(() => startSessionDeferred.promise);
    const harness = createHookHarness({
      ...createBaseArgs(),
      loadRepoSettings,
      startAgentSession,
    });

    const buildContinuationTargetGet = mock(async () => ({
      workingDirectory: "/repo/worktrees/task-1",
      source: "builder_session" as const,
    }));
    host.buildContinuationTargetGet = buildContinuationTargetGet;

    try {
      await harness.mount();

      await harness.run((state) => {
        state.onDelegate("TASK-1");
      });

      const modal = harness.getLatest().sessionStartModal;
      expect(modal).not.toBeNull();
      expect(modal?.selectedStartMode).toBe("reuse");
      expect(modal?.selectedModelSelection).toBeNull();

      await harness.run(async () => {
        modal?.onConfirm({
          runInBackground: false,
          startMode: "reuse",
          sourceSessionId: "builder-session-2",
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(loadRepoSettings).not.toHaveBeenCalled();
      expect(buildContinuationTargetGet).not.toHaveBeenCalled();
      expect(startAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "TASK-1",
          role: "build",
          scenario: "build_after_human_request_changes",
          startMode: "reuse",
          sourceSessionId: "builder-session-2",
        }),
      );

      startSessionDeferred.resolve("session-new");
    } finally {
      host.buildContinuationTargetGet = originalBuildContinuationTargetGet;
      await harness.unmount();
    }
  });

  test("human review new-session feedback opens the shared start modal in fresh mode", async () => {
    const bootstrapTaskSessions = mock(async () => {});
    const humanRequestChangesTask = mock(async () => {});
    const startAgentSession = mock(async () => "session-new");
    const sendAgentMessage = mock(async () => {});
    const harness = createHookHarness({
      ...createBaseArgs(),
      bootstrapTaskSessions,
      humanRequestChangesTask,
      startAgentSession,
      sendAgentMessage,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await state.onHumanRequestChanges("TASK-1");
    });

    const feedbackModal = harness.getLatest().humanReviewFeedbackModal;
    expect(feedbackModal).not.toBeNull();

    await harness.run(async () => {
      feedbackModal?.onTargetChange("new_session");
      feedbackModal?.onMessageChange("Use a fresh builder session for these changes.");
    });

    await harness.run(async () => {
      await harness.getLatest().humanReviewFeedbackModal?.onConfirm();
    });

    const sessionStartModal = harness.getLatest().sessionStartModal;
    expect(sessionStartModal).not.toBeNull();
    expect(sessionStartModal?.open).toBe(true);
    expect(sessionStartModal?.selectedStartMode).toBe("fresh");
    expect(sessionStartModal?.availableStartModes).toEqual(["fresh", "reuse"]);
    expect(sessionStartModal?.existingSessionOptions).toEqual([
      expect.objectContaining({ value: "builder-session-2" }),
      expect.objectContaining({ value: "builder-session-1" }),
    ]);
    expect(humanRequestChangesTask).not.toHaveBeenCalled();
    expect(startAgentSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("ai review new-session feedback opens the shared start modal in fresh mode", async () => {
    const bootstrapTaskSessions = mock(async () => {});
    const harness = createHookHarness({
      ...createBaseArgs(),
      tasks: [createTaskCardFixture({ id: "TASK-1", status: "ai_review" })],
      bootstrapTaskSessions,
    });

    await harness.mount();
    await harness.run(async (state) => {
      await state.onHumanRequestChanges("TASK-1");
    });

    const feedbackModal = harness.getLatest().humanReviewFeedbackModal;
    expect(feedbackModal).not.toBeNull();

    await harness.run(async () => {
      feedbackModal?.onTargetChange("new_session");
      feedbackModal?.onMessageChange("Please address the AI review feedback in a fresh session.");
    });

    await harness.run(async () => {
      await harness.getLatest().humanReviewFeedbackModal?.onConfirm();
    });

    const sessionStartModal = harness.getLatest().sessionStartModal;
    expect(sessionStartModal).not.toBeNull();
    expect(sessionStartModal?.open).toBe(true);
    expect(sessionStartModal?.selectedStartMode).toBe("fresh");
    expect(sessionStartModal?.availableStartModes).toEqual(["fresh", "reuse"]);

    await harness.unmount();
  });
});
