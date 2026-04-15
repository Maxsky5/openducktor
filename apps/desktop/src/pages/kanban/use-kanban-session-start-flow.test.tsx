import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { toast } from "sonner";
import { HUMAN_REVIEW_FEEDBACK_BOOTSTRAP_FAILURE_MESSAGE } from "@/features/human-review-feedback/human-review-feedback-flow";
import { QueryProvider } from "@/lib/query-provider";
import { ChecksOperationsContext, RuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { host } from "@/state/operations/shared/host";
import { createHookHarness as createCoreHookHarness } from "@/test-utils/react-hook-harness";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  createAgentSessionFixture,
  createBeadsCheckFixture,
  createDeferred,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "../agents/agent-studio-test-utils";
import {
  resolveKanbanBuildStartScenario,
  useKanbanSessionStartFlow,
} from "./use-kanban-session-start-flow";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useKanbanSessionStartFlow>[0];

const createModalCatalog = (): AgentModelCatalog => ({
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["default", "high"],
      contextWindow: 200_000,
      outputLimit: 8_192,
    },
  ],
  defaultModelsByProvider: {
    openai: "gpt-5",
  },
  profiles: [
    {
      name: "builder",
      mode: "primary",
      hidden: false,
    },
    {
      name: "qa",
      mode: "primary",
      hidden: false,
    },
    {
      name: "spec",
      mode: "primary",
      hidden: false,
    },
    {
      name: "planner",
      mode: "primary",
      hidden: false,
    },
  ],
});

const createHookHarness = (initialProps: HookArgs) => {
  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(
      ChecksOperationsContext.Provider,
      {
        value: {
          refreshRuntimeCheck: async () => ({
            gitOk: true,
            gitVersion: null,
            ghOk: true,
            ghVersion: null,
            ghAuthOk: true,
            ghAuthLogin: null,
            ghAuthError: null,
            runtimes: [],
            errors: [],
          }),
          refreshBeadsCheckForRepo: async () => createBeadsCheckFixture(),
          refreshRepoRuntimeHealthForRepo: async () => ({}),
          clearActiveBeadsCheck: () => {},
          clearActiveRepoRuntimeHealth: () => {},
          setIsLoadingChecks: () => {},
          hasRuntimeCheck: () => false,
          hasCachedBeadsCheck: () => false,
          hasCachedRepoRuntimeHealth: () => false,
        },
      },
      createElement(
        QueryProvider,
        { useIsolatedClient: true },
        createElement(RuntimeDefinitionsContext.Provider, {
          value: {
            runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
            isLoadingRuntimeDefinitions: false,
            runtimeDefinitionsError: null,
            refreshRuntimeDefinitions: async () => [OPENCODE_RUNTIME_DESCRIPTOR],
            loadRepoRuntimeCatalog: async () => createModalCatalog(),
            loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
            loadRepoRuntimeFileSearch: async () => [],
          },
          children,
        }),
      ),
    );

  return createCoreHookHarness(useKanbanSessionStartFlow, initialProps, { wrapper });
};

const createDefaultRepoSettings = (): RepoSettingsInput => ({
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
});

const createBaseArgs = (): HookArgs => ({
  activeRepo: "/repo",
  branches: [
    { name: "main", isCurrent: true, isRemote: false },
    { name: "origin/main", isCurrent: false, isRemote: true },
    { name: "origin/release/2026.04", isCurrent: false, isRemote: true },
  ],
  repoSettings: null,
  tasks: [createTaskCardFixture({ id: "TASK-1", status: "human_review" })],
  sessions: [
    createAgentSessionFixture({
      sessionId: "builder-session-2",
      taskId: "TASK-1",
      runtimeKind: "opencode",
      role: "build",
      scenario: "build_after_qa_rejected",
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "builder",
      },
      startedAt: "2026-03-20T12:00:00.000Z",
    }),
    createAgentSessionFixture({
      sessionId: "builder-session-1",
      taskId: "TASK-1",
      runtimeKind: "opencode",
      role: "build",
      scenario: "build_implementation_start",
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "builder",
      },
      startedAt: "2026-03-19T12:00:00.000Z",
    }),
  ],
  navigate: mock(() => {}),
  loadRepoSettings: async () => createDefaultRepoSettings(),
  bootstrapTaskSessions: async () => {},
  hydrateRequestedTaskSessionHistory: async () => {},
  loadAgentSessions: async () => {},
  humanRequestChangesTask: async () => {},
  setTaskTargetBranch: async () => {},
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

  test("blocks builder start when the persisted task target branch is invalid", async () => {
    const originalToastError = toast.error;
    const toastError = mock(() => "toast-id");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      ...createBaseArgs(),
      tasks: [
        createTaskCardFixture({
          id: "TASK-1",
          status: "ready_for_dev",
          targetBranchError:
            "Invalid openducktor.targetBranch metadata: missing field `branch`. Fix the saved task metadata or choose a valid target branch again.",
        }),
      ],
    });

    try {
      await harness.mount();
      await harness.run(async (state) => {
        state.onDelegate("TASK-1");
        await Promise.resolve();
      });

      expect(harness.getLatest().sessionStartModal).toBeNull();
      expect(toastError).toHaveBeenCalledWith("Invalid task target branch", {
        description:
          "Invalid openducktor.targetBranch metadata: missing field `branch`. Fix the saved task metadata or choose a valid target branch again.",
      });
    } finally {
      (toast as { error: typeof toast.error }).error = originalToastError;
      await harness.unmount();
    }
  });

  test("does not block QA start when a task has an invalid build target branch", async () => {
    const originalToastError = toast.error;
    const toastError = mock(() => "toast-id");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      ...createBaseArgs(),
      tasks: [
        createTaskCardFixture({
          id: "TASK-1",
          status: "ready_for_dev",
          targetBranchError:
            "Invalid openducktor.targetBranch metadata: missing field `branch`. Fix the saved task metadata or choose a valid target branch again.",
        }),
      ],
    });

    try {
      await harness.mount();
      await harness.run(async (state) => {
        state.onQaStart("TASK-1");
        await Promise.resolve();
      });

      expect(harness.getLatest().sessionStartModal?.title).toBe("Start QA Session");
      expect(toastError).not.toHaveBeenCalled();
    } finally {
      (toast as { error: typeof toast.error }).error = originalToastError;
      await harness.unmount();
    }
  });

  test("opens the shared session start modal for pull request generation with reuse as the default builder flow", async () => {
    const harness = createHookHarness(createBaseArgs());
    let startPromise: Promise<string | undefined> | undefined;

    await harness.mount();
    await harness.run((state) => {
      startPromise = state.onPullRequestGenerate("TASK-1");
    });

    const modal = harness.getLatest().sessionStartModal;
    expect(modal).not.toBeNull();
    expect(modal?.title).toBe("Start Builder Session");
    expect(modal?.availableStartModes).toEqual(["reuse", "fork"]);
    expect(modal?.selectedStartMode).toBe("reuse");
    expect(modal?.selectedSourceSessionId).toBe("builder-session-2");
    expect(modal?.description).toBe(
      "Choose how to reuse an existing session or fork an existing session for Generate Pull Request.",
    );
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

    await harness.run((state) => {
      state.sessionStartModal?.onOpenChange(false);
    });
    expect(await startPromise).toBeUndefined();

    await harness.unmount();
  });

  test("pull request generation resolves with the started builder session id using reuse by default", async () => {
    const startAgentSession = mock(async () => "builder-session-pr");
    const args = createBaseArgs();
    args.repoSettings = {
      ...createDefaultRepoSettings(),
      agentDefaults: {
        spec: null,
        planner: null,
        build: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "default",
          profileId: "builder",
        },
        qa: null,
      },
    };
    args.startAgentSession = startAgentSession;

    const harness = createHookHarness(args);

    await harness.mount();

    let startPromise: Promise<string | undefined> | undefined;
    await harness.run((state) => {
      startPromise = state.onPullRequestGenerate("TASK-1");
    });

    await harness.waitFor((state) => state.sessionStartModal != null);

    await harness.run((state) => {
      state.sessionStartModal?.onSelectAgent("builder");
      state.sessionStartModal?.onSelectModel("openai/gpt-5");
    });

    await harness.run(async (state) => {
      state.sessionStartModal?.onConfirm({
        runInBackground: false,
        startMode: "reuse",
        sourceSessionId: "builder-session-2",
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await startPromise).toBe("builder-session-pr");
    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "TASK-1",
        role: "build",
        scenario: "build_pull_request_generation",
        startMode: "reuse",
        sourceSessionId: "builder-session-2",
      }),
    );

    await harness.unmount();
  });

  test("build starts persist the selected task target branch before starting the session", async () => {
    const callOrder: string[] = [];
    const setTaskTargetBranch = mock(async () => {
      callOrder.push("target-branch");
    });
    const startAgentSession = mock(async () => {
      callOrder.push("start-session");
      return "builder-session-new";
    });
    const args = createBaseArgs();
    args.repoSettings = {
      ...createDefaultRepoSettings(),
      agentDefaults: {
        spec: null,
        planner: null,
        build: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "default",
          profileId: "builder",
        },
        qa: null,
      },
    };
    args.tasks = [createTaskCardFixture({ id: "TASK-1", status: "ready_for_dev" })];
    args.setTaskTargetBranch = setTaskTargetBranch;
    args.startAgentSession = startAgentSession;

    const harness = createHookHarness(args);
    await harness.mount();

    await harness.run((state) => {
      state.onDelegate("TASK-1");
    });

    await harness.waitFor((state) => state.sessionStartModal?.selectedModelSelection != null);

    await harness.run(async (state) => {
      state.sessionStartModal?.onConfirm({
        runInBackground: false,
        startMode: "fresh",
        sourceSessionId: null,
        targetBranch: "refs/remotes/origin/release/2026.04",
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setTaskTargetBranch).toHaveBeenCalledWith("TASK-1", {
      remote: "origin",
      branch: "release/2026.04",
    });
    expect(callOrder).toEqual(["target-branch", "start-session"]);

    await harness.unmount();
  });

  test("pull request generation resolves with undefined when the shared start modal is cancelled", async () => {
    const args = createBaseArgs();
    args.repoSettings = createDefaultRepoSettings();

    const harness = createHookHarness(args);

    await harness.mount();

    let startPromise: Promise<string | undefined> | undefined;
    await harness.run((state) => {
      startPromise = state.onPullRequestGenerate("TASK-1");
    });

    await harness.waitFor((state) => state.sessionStartModal !== null);

    await harness.run((state) => {
      state.sessionStartModal?.onOpenChange(false);
    });

    expect(await startPromise).toBeUndefined();
    expect(harness.getLatest().sessionStartModal).toBeNull();

    await harness.unmount();
  });

  test("pull request generation rejects when no builder session is available to fork or reuse", async () => {
    const args = createBaseArgs();
    args.sessions = [];

    const harness = createHookHarness(args);

    await harness.mount();

    let startPromise: Promise<string | undefined> | undefined;
    await harness.run((state) => {
      startPromise = state.onPullRequestGenerate("TASK-1");
      void startPromise.catch(() => undefined);
    });

    await expect(startPromise).rejects.toThrow(
      'No Builder session is available to fork or reuse for task "TASK-1".',
    );
    expect(harness.getLatest().sessionStartModal).toBeNull();

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
    const baseArgs = createBaseArgs();
    const harness = createHookHarness({
      ...baseArgs,
      sessions: baseArgs.sessions.map((session) => ({ ...session, selectedModel: null })),
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

  test("human review bootstrap failures surface the canonical builder-session toast", async () => {
    const originalToastError = toast.error;
    const toastError = mock(() => "toast-id");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

    const harness = createHookHarness({
      ...createBaseArgs(),
      bootstrapTaskSessions: mock(async () => {
        throw new Error("bootstrap failed");
      }),
    });

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.onHumanRequestChanges("TASK-1");
      });

      expect(harness.getLatest().humanReviewFeedbackModal).toBeNull();
      expect(toastError).toHaveBeenCalledWith(HUMAN_REVIEW_FEEDBACK_BOOTSTRAP_FAILURE_MESSAGE);
    } finally {
      (toast as { error: typeof toast.error }).error = originalToastError;
      await harness.unmount();
    }
  });

  test("onOpenSession uses explicit session id when provided", async () => {
    const args = createBaseArgs();
    const harness = createHookHarness(args);

    await harness.mount();
    await harness.run((state) => {
      state.onOpenSession("TASK-1", "build", {
        sessionId: "builder-session-1",
        scenario: "build_implementation_start",
      });
    });

    expect(args.navigate).toHaveBeenCalledWith(
      "/agents?task=TASK-1&session=builder-session-1&agent=build&scenario=build_implementation_start",
    );

    await harness.unmount();
  });

  test("onOpenSession uses explicit session id even when it is not currently hydrated", async () => {
    const args = createBaseArgs();
    const harness = createHookHarness(args);

    await harness.mount();
    await harness.run((state) => {
      state.onOpenSession("TASK-1", "build", {
        sessionId: "builder-session-archived",
        scenario: "build_after_qa_rejected",
      });
    });

    expect(args.navigate).toHaveBeenCalledWith(
      "/agents?task=TASK-1&session=builder-session-archived&agent=build&scenario=build_after_qa_rejected",
    );

    await harness.unmount();
  });

  test("onOpenSession uses latest role session when explicit id is absent", async () => {
    const args = createBaseArgs();
    const harness = createHookHarness(args);

    await harness.mount();
    await harness.run((state) => {
      state.onOpenSession("TASK-1", "build", { scenario: "build_implementation_start" });
    });

    expect(args.navigate).toHaveBeenCalledWith(
      "/agents?task=TASK-1&session=builder-session-2&agent=build&scenario=build_after_qa_rejected",
    );

    await harness.unmount();
  });

  test("onOpenSession falls back to agent+scenario when no matching session exists", async () => {
    const args = createBaseArgs();
    args.sessions = [];
    const harness = createHookHarness(args);

    await harness.mount();
    await harness.run((state) => {
      state.onOpenSession("TASK-404", "qa", { scenario: "qa_review" });
    });

    expect(args.navigate).toHaveBeenCalledWith("/agents?task=TASK-404&agent=qa&scenario=qa_review");

    await harness.unmount();
  });

  test("onOpenSession prefers waiting-input session before latest-by-time fallback", async () => {
    const args = createBaseArgs();
    args.sessions = [
      createAgentSessionFixture({
        sessionId: "builder-session-new-running",
        taskId: "TASK-1",
        runtimeKind: "opencode",
        role: "build",
        scenario: "build_after_qa_rejected",
        status: "running",
        pendingPermissions: [],
        pendingQuestions: [],
        startedAt: "2026-03-20T12:00:00.000Z",
      }),
      createAgentSessionFixture({
        sessionId: "builder-session-old-waiting",
        taskId: "TASK-1",
        runtimeKind: "opencode",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        pendingPermissions: [],
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [
              {
                header: "Question",
                question: "Need input",
                options: [{ label: "Continue", description: "Continue build" }],
              },
            ],
          },
        ],
        startedAt: "2026-03-19T12:00:00.000Z",
      }),
    ];
    const harness = createHookHarness(args);

    await harness.mount();
    await harness.run((state) => {
      state.onOpenSession("TASK-1", "build", { scenario: "build_after_qa_rejected" });
    });

    expect(args.navigate).toHaveBeenCalledWith(
      "/agents?task=TASK-1&session=builder-session-old-waiting&agent=build&scenario=build_implementation_start",
    );

    await harness.unmount();
  });
});
