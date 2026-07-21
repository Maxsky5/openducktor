import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RepoConfig,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { toast } from "sonner";
import {
  createSessionStartWorkflowRunner,
  resolveBuildContinuationLaunchAction,
} from "@/features/session-start";
import { QueryProvider } from "@/lib/query-provider";
import {
  ChecksOperationsContext,
  ChecksStateContext,
  RepoRuntimeHealthContext,
  RuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import { host } from "@/state/operations/shared/host";
import { createHookHarness as createCoreHookHarness } from "@/test-utils/react-hook-harness";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import type { RepoSettingsInput } from "@/types/state-slices";
import { parsePersistedTaskTabs } from "../agents/agent-studio-task-tabs-storage";
import {
  createAgentSessionSummaryFixture,
  createChecksStateContextValue,
  createDeferred,
  createRepoRuntimeHealthContextValue,
  createTaskCardFixture,
  createTaskStoreCheckFixture,
  enableReactActEnvironment,
} from "../agents/agent-studio-test-utils";
import { toTabsStorageKey } from "../agents/query-sync/agent-studio-navigation";
import { useKanbanSessionStartFlow } from "./use-kanban-session-start-flow";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useKanbanSessionStartFlow>[0];

const sessionIdentity = (externalSessionId: string) => ({
  externalSessionId,
  runtimeKind: "opencode" as const,
  workingDirectory: `/repo/worktrees/${externalSessionId}`,
});

const createRunSessionStartWorkflow = (
  overrides: Partial<Parameters<typeof createSessionStartWorkflowRunner>[0]> = {},
) =>
  createSessionStartWorkflowRunner({
    queryClient: new QueryClient(),
    workspaceId: "workspace-1",
    startAgentSession: async () => sessionIdentity("session-new"),
    sendAgentMessage: async () => {},
    ...overrides,
  });

const agentStudioSessionUrl = (
  taskId: string,
  role: string,
  session: { externalSessionId: string },
): string => {
  const search = new URLSearchParams({
    task: taskId,
    session: session.externalSessionId,
    agent: role,
  });
  return `/agents?${search.toString()}`;
};

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
  const checksStateContextValue = createChecksStateContextValue();
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
          refreshTaskStoreCheckForRepo: async () => createTaskStoreCheckFixture(),
          clearActiveTaskStoreCheck: () => {},
          setIsLoadingChecks: () => {},
          hasRuntimeCheck: () => false,
          hasCachedTaskStoreCheck: () => false,
        },
      },
      createElement(
        QueryProvider,
        { useIsolatedClient: true },
        createElement(
          RepoRuntimeHealthContext.Provider,
          {
            value: createRepoRuntimeHealthContextValue(),
          },
          createElement(
            ChecksStateContext.Provider,
            { value: checksStateContextValue },
            createElement(
              RuntimeDefinitionsContext.Provider,
              {
                value: {
                  runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
                  availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
                  agentRuntimes: DEFAULT_AGENT_RUNTIMES,
                  isLoadingRuntimeDefinitions: false,
                  runtimeDefinitionsError: null,
                  refreshRuntimeDefinitions: async () => [OPENCODE_RUNTIME_DESCRIPTOR],
                  loadRepoRuntimeCatalog: async () => createModalCatalog(),
                  loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
                  loadRepoRuntimeSkills: async () => ({ skills: [] }),
                  loadRepoRuntimeSubagents: async () => ({ subagents: [] }),
                  loadRepoRuntimeFileSearch: async () => [],
                },
              },
              children,
            ),
          ),
        ),
      ),
    );

  return createCoreHookHarness(useKanbanSessionStartFlow, initialProps, { wrapper });
};

const createDefaultRepoSettings = (): RepoSettingsInput => ({
  defaultRuntimeKind: "opencode",
  worktreeBasePath: ".worktrees",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  preStartHooks: [],
  postCompleteHooks: [],
  devServers: [],
  worktreeCopyPaths: [],
  agentDefaults: {
    spec: null,
    planner: null,
    build: null,
    qa: null,
  },
});

const createRepoConfigFixture = (): RepoConfig => ({
  workspaceId: "workspace-1",
  workspaceName: "Workspace",
  repoPath: "/repo",
  defaultRuntimeKind: "opencode",
  worktreeBasePath: undefined,
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {
    providers: {},
  },
  hooks: {
    preStart: [],
    postComplete: [],
  },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {
    spec: undefined,
    planner: undefined,
    build: undefined,
    qa: undefined,
  },
});

const createBaseArgs = (): HookArgs => ({
  activeWorkspaceId: "workspace-1",
  workspaceRepoPath: "/repo",
  branches: [
    { name: "main", isCurrent: true, isRemote: false },
    { name: "origin/main", isCurrent: false, isRemote: true },
    { name: "origin/release/2026.04", isCurrent: false, isRemote: true },
  ],
  repoSettings: null,
  openAgentStudioTabOnBackgroundSessionStart: true,
  tasks: [createTaskCardFixture({ id: "TASK-1", status: "human_review" })],
  sessions: [
    createAgentSessionSummaryFixture({
      externalSessionId: "builder-session-2",
      taskId: "TASK-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/builder-session-2",
      role: "build",
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "builder",
      },
      startedAt: "2026-03-20T12:00:00.000Z",
    }),
    createAgentSessionSummaryFixture({
      externalSessionId: "builder-session-1",
      taskId: "TASK-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/builder-session-1",
      role: "build",
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
  humanRequestChangesTask: async () => {},
  setTaskTargetBranch: async () => {},
  runSessionStartWorkflow: createRunSessionStartWorkflow(),
});

describe("resolveBuildContinuationLaunchAction", () => {
  test("uses implementation start for regular build starts", () => {
    const task = createTaskCardFixture({ id: "TASK-1", status: "ready_for_dev" });

    expect(resolveBuildContinuationLaunchAction(task)).toBe("build_implementation_start");
  });

  test("uses QA rejection follow-up for QA-rejected tasks", () => {
    const task = createTaskCardFixture({ id: "TASK-1", status: "in_progress" });
    task.documentSummary.qaReport = {
      has: true,
      updatedAt: "2026-03-09T10:00:00.000Z",
      verdict: "rejected",
    };

    expect(resolveBuildContinuationLaunchAction(task)).toBe("build_after_qa_rejected");
  });

  test("uses human-feedback follow-up for human-review tasks", () => {
    const task = createTaskCardFixture({ id: "TASK-1", status: "human_review" });

    expect(resolveBuildContinuationLaunchAction(task)).toBe("build_after_human_request_changes");
  });
});

describe("useKanbanSessionStartFlow", () => {
  const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
  const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;

  beforeEach(() => {
    host.workspaceGetRepoConfig = async () => createRepoConfigFixture();
    host.workspaceGetSettingsSnapshot = async () => createSettingsSnapshotFixture();
  });

  afterEach(() => {
    host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
    host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
  });

  test("rejects session starts while settings are unavailable", async () => {
    const args = createBaseArgs();
    args.openAgentStudioTabOnBackgroundSessionStart = null;

    const harness = createHookHarness(args);
    await harness.mount();

    await expect(
      harness.getLatest().startSessionIntent({
        taskId: "TASK-1",
        role: "build",
        launchActionId: "build_implementation_start",
        postStartAction: "kickoff",
      }),
    ).rejects.toThrow("Cannot start Kanban session because settings have not loaded.");

    expect(harness.getLatest().sessionStartModal).toBeNull();

    await harness.unmount();
  });

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
    expect(modal?.selectedSourceSessionValue).toBe(modal?.existingSessionOptions[0]?.value);
    expect(modal?.description).toBe(
      "Choose how to reuse an existing session or fork an existing session for Generate Pull Request.",
    );
    const latestBuilderDescription = `${new Date(
      "2026-03-20T12:00:00.000Z",
    ).toLocaleString()} · idle · builder-`;
    const olderBuilderDescription = `${new Date(
      "2026-03-19T12:00:00.000Z",
    ).toLocaleString()} · idle · builder-`;
    expect(modal?.existingSessionOptions).toEqual([
      expect.objectContaining({
        sourceSession: {
          externalSessionId: "builder-session-2",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktrees/builder-session-2",
        },
        label: "Builder #2",
        description: latestBuilderDescription,
        secondaryLabel: "Latest",
        selectedModel: expect.objectContaining({ profileId: "builder" }),
      }),
      expect.objectContaining({
        sourceSession: {
          externalSessionId: "builder-session-1",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktrees/builder-session-1",
        },
        label: "Builder #1",
        description: olderBuilderDescription,
        selectedModel: expect.objectContaining({ profileId: "builder" }),
      }),
    ]);

    await harness.run((state) => {
      state.sessionStartModal?.onOpenChange(false);
    });
    expect(await startPromise).toBeUndefined();

    await harness.unmount();
  });

  test("pull request generation resolves with the started builder session id using reuse by default", async () => {
    const startAgentSession = mock(async () => sessionIdentity("builder-session-pr"));
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
    args.runSessionStartWorkflow = createRunSessionStartWorkflow({ startAgentSession });

    const harness = createHookHarness(args);

    await harness.mount();

    let startPromise: Promise<string | undefined> | undefined;
    await harness.run((state) => {
      startPromise = state.onPullRequestGenerate("TASK-1");
    });

    await harness.waitFor((state) => state.sessionStartModal != null);
    const selectedSourceSessionValue =
      harness.getLatest().sessionStartModal?.selectedSourceSessionValue ?? null;

    await harness.run((state) => {
      state.sessionStartModal?.onSelectAgent("builder");
      state.sessionStartModal?.onSelectModel("openai/gpt-5");
    });

    await harness.run(async (state) => {
      await state.sessionStartModal?.onConfirm({
        runInBackground: false,
        startMode: "reuse",
        sourceSessionOptionValue: selectedSourceSessionValue,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await startPromise).toBe("builder-session-pr");
    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "TASK-1",
        role: "build",
        startMode: "reuse",
        sourceSession: {
          externalSessionId: "builder-session-2",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktrees/builder-session-2",
        },
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
      return sessionIdentity("builder-session-new");
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
    args.runSessionStartWorkflow = createRunSessionStartWorkflow({ startAgentSession });

    const harness = createHookHarness(args);
    await harness.mount();

    await harness.run((state) => {
      state.onDelegate("TASK-1");
    });

    await harness.waitFor((state) => state.sessionStartModal?.selectedModelSelection != null);

    await harness.run(async (state) => {
      await state.sessionStartModal?.onConfirm({
        runInBackground: false,
        startMode: "fresh",
        sourceSessionOptionValue: null,
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

  test("background start adds one Agent Studio task tab when setting is enabled", async () => {
    const originalToastSuccess = toast.success;
    const toastSuccess = mock(() => "toast-id");
    (toast as { success: typeof toast.success }).success =
      toastSuccess as unknown as typeof toast.success;
    const storageKey = toTabsStorageKey("workspace-1");
    globalThis.localStorage.removeItem(storageKey);
    const navigate = mock(() => {});
    const args = createBaseArgs();
    args.navigate = navigate;
    args.repoSettings = createDefaultRepoSettings();
    args.tasks = [createTaskCardFixture({ id: "TASK-1", status: "ready_for_dev" })];

    const harness = createHookHarness(args);
    try {
      await harness.mount();

      await harness.run((state) => {
        state.onDelegate("TASK-1");
      });
      await harness.waitFor((state) => state.sessionStartModal?.selectedModelSelection != null);

      await harness.run(async (state) => {
        await state.sessionStartModal?.onConfirm({
          runInBackground: true,
          startMode: "fresh",
          sourceSessionOptionValue: null,
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(parsePersistedTaskTabs(globalThis.localStorage.getItem(storageKey))).toEqual({
        tabs: ["TASK-1"],
        activeTaskId: null,
      });
      expect(navigate).not.toHaveBeenCalled();
      expect(toastSuccess).toHaveBeenCalled();

      await harness.run((state) => {
        state.onDelegate("TASK-1");
      });
      await harness.waitFor((state) => state.sessionStartModal?.selectedModelSelection != null);
      await harness.run(async (state) => {
        state.sessionStartModal?.onConfirm({
          runInBackground: true,
          startMode: "fresh",
          sourceSessionOptionValue: null,
        });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(parsePersistedTaskTabs(globalThis.localStorage.getItem(storageKey)).tabs).toEqual([
        "TASK-1",
      ]);
    } finally {
      globalThis.localStorage.removeItem(storageKey);
      (toast as { success: typeof toast.success }).success = originalToastSuccess;
      await harness.unmount();
    }
  });

  test("background start does not add Agent Studio task tab when setting is disabled", async () => {
    const storageKey = toTabsStorageKey("workspace-1");
    globalThis.localStorage.removeItem(storageKey);
    const args = createBaseArgs();
    args.repoSettings = createDefaultRepoSettings();
    args.openAgentStudioTabOnBackgroundSessionStart = false;
    args.tasks = [createTaskCardFixture({ id: "TASK-1", status: "ready_for_dev" })];

    const harness = createHookHarness(args);
    try {
      await harness.mount();
      await harness.run((state) => {
        state.onDelegate("TASK-1");
      });
      await harness.waitFor((state) => state.sessionStartModal?.selectedModelSelection != null);
      await harness.run(async (state) => {
        state.sessionStartModal?.onConfirm({
          runInBackground: true,
          startMode: "fresh",
          sourceSessionOptionValue: null,
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(globalThis.localStorage.getItem(storageKey)).toBeNull();
    } finally {
      globalThis.localStorage.removeItem(storageKey);
      await harness.unmount();
    }
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

  test("reuse confirm starts directly from the source session when the reused session has no saved model", async () => {
    const originalBuildContinuationTargetGet = host.taskWorktreeGet;
    const startSessionDeferred = createDeferred<ReturnType<typeof sessionIdentity>>();
    const startAgentSession = mock(() => startSessionDeferred.promise);
    const baseArgs = createBaseArgs();
    const harness = createHookHarness({
      ...baseArgs,
      tasks: [createTaskCardFixture({ id: "TASK-1", status: "ready_for_dev" })],
      sessions: baseArgs.sessions.map((session) => ({ ...session, selectedModel: null })),
      runSessionStartWorkflow: createRunSessionStartWorkflow({ startAgentSession }),
    });

    const taskWorktreeGet = mock(async () => ({
      workingDirectory: "/repo/worktrees/task-1",
      source: "builder_session" as const,
    }));
    host.taskWorktreeGet = taskWorktreeGet;

    try {
      await harness.mount();

      let startPromise: Promise<string | undefined> | undefined;
      await harness.run((state) => {
        startPromise = state.onPullRequestGenerate("TASK-1");
      });

      const modal = harness.getLatest().sessionStartModal;
      expect(modal).not.toBeNull();
      expect(modal?.selectedStartMode).toBe("reuse");
      expect(modal?.selectedModelSelection).toBeNull();
      const selectedSourceSessionValue = modal?.selectedSourceSessionValue ?? null;

      await harness.run(async () => {
        modal?.onConfirm({
          runInBackground: false,
          startMode: "reuse",
          sourceSessionOptionValue: selectedSourceSessionValue,
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(taskWorktreeGet).not.toHaveBeenCalled();
      expect(startAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "TASK-1",
          role: "build",
          startMode: "reuse",
          sourceSession: {
            externalSessionId: "builder-session-2",
            runtimeKind: "opencode",
            workingDirectory: "/repo/worktrees/builder-session-2",
          },
        }),
      );

      await harness.run(async () => {
        startSessionDeferred.resolve(sessionIdentity("session-new"));
        await startPromise;
      });
      await expect(startPromise).resolves.toBe("session-new");
    } finally {
      host.taskWorktreeGet = originalBuildContinuationTargetGet;
      await harness.unmount();
    }
  });

  test("human review feedback opens the shared start modal with reuse selected by default when builder sessions exist", async () => {
    const humanRequestChangesTask = mock(async () => {});
    const startAgentSession = mock(async () => sessionIdentity("session-new"));
    const sendAgentMessage = mock(async () => {});
    const harness = createHookHarness({
      ...createBaseArgs(),
      humanRequestChangesTask,
      runSessionStartWorkflow: createRunSessionStartWorkflow({
        startAgentSession,
        sendAgentMessage,
      }),
    });

    await harness.mount();
    await harness.waitFor((state) => state !== null);
    await harness.run((state) => {
      state.onHumanRequestChanges("TASK-1");
    });

    const feedbackModal = harness.getLatest().humanReviewFeedbackModal;
    expect(feedbackModal).not.toBeNull();
    expect(feedbackModal?.message).toBe("");

    await harness.run(async () => {
      feedbackModal?.onMessageChange("Use the latest builder session for these changes.");
    });

    await harness.run(() => {
      void harness.getLatest().humanReviewFeedbackModal?.onConfirm();
    });

    await harness.waitFor((state) => state.sessionStartModal !== null);
    const sessionStartModal = harness.getLatest().sessionStartModal;
    expect(sessionStartModal).not.toBeNull();
    expect(sessionStartModal?.open).toBe(true);
    expect(sessionStartModal?.selectedStartMode).toBe("reuse");
    expect(sessionStartModal?.selectedSourceSessionValue).toBe(
      sessionStartModal?.existingSessionOptions[0]?.value,
    );
    expect(sessionStartModal?.availableStartModes).toEqual(["fresh", "reuse"]);
    expect(sessionStartModal?.existingSessionOptions).toEqual([
      expect.objectContaining({
        sourceSession: expect.objectContaining({ externalSessionId: "builder-session-2" }),
      }),
      expect.objectContaining({
        sourceSession: expect.objectContaining({ externalSessionId: "builder-session-1" }),
      }),
    ]);
    expect(humanRequestChangesTask).not.toHaveBeenCalled();
    expect(startAgentSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("human review feedback opens the shared start modal in fresh mode when no builder session exists", async () => {
    const [task] = createBaseArgs().tasks;
    expect(task).toBeDefined();
    const harness = createHookHarness({
      ...createBaseArgs(),
      tasks: task ? [task] : [],
      sessions: [],
    });

    await harness.mount();
    await harness.waitFor((state) => state !== null);
    await harness.run((state) => {
      state.onHumanRequestChanges("TASK-1");
    });

    expect(harness.getLatest().humanReviewFeedbackModal?.open).toBe(true);

    await harness.run(async (state) => {
      state.humanReviewFeedbackModal?.onMessageChange(
        "Use a fresh builder session for these changes.",
      );
    });

    await harness.run((state) => {
      void state.humanReviewFeedbackModal?.onConfirm();
    });

    await harness.waitFor((state) => state.sessionStartModal !== null);
    const sessionStartModal = harness.getLatest().sessionStartModal;
    expect(sessionStartModal).not.toBeNull();
    expect(sessionStartModal?.open).toBe(true);
    expect(sessionStartModal?.selectedStartMode).toBe("fresh");
    expect(sessionStartModal?.existingSessionOptions).toEqual([]);

    await harness.unmount();
  });

  test("ai review feedback opens the shared start modal with reuse selected by default", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      tasks: [createTaskCardFixture({ id: "TASK-1", status: "ai_review" })],
    });

    await harness.mount();
    await harness.waitFor((state) => state !== null);
    await harness.run((state) => {
      state.onHumanRequestChanges("TASK-1");
    });

    const feedbackModal = harness.getLatest().humanReviewFeedbackModal;
    expect(feedbackModal).not.toBeNull();

    await harness.run(async () => {
      feedbackModal?.onMessageChange("Please address the AI review feedback in a fresh session.");
    });

    await harness.run(() => {
      void harness.getLatest().humanReviewFeedbackModal?.onConfirm();
    });

    await harness.waitFor((state) => state.sessionStartModal !== null);
    const sessionStartModal = harness.getLatest().sessionStartModal;
    expect(sessionStartModal).not.toBeNull();
    expect(sessionStartModal?.open).toBe(true);
    expect(sessionStartModal?.selectedStartMode).toBe("reuse");
    expect(sessionStartModal?.selectedSourceSessionValue).toBe(
      sessionStartModal?.existingSessionOptions[0]?.value,
    );
    expect(sessionStartModal?.availableStartModes).toEqual(["fresh", "reuse"]);

    await harness.unmount();
  });

  test("canceling the shared request-changes start modal restores the feedback draft", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
    });

    await harness.mount();
    await harness.waitFor((state) => state !== null);
    await harness.run((state) => {
      state.onHumanRequestChanges("TASK-1");
    });

    await harness.run(async (state) => {
      state.humanReviewFeedbackModal?.onMessageChange("Keep this request-changes draft.");
    });

    await harness.run((state) => {
      void state.humanReviewFeedbackModal?.onConfirm();
    });

    await harness.waitFor((state) => state.sessionStartModal !== null);

    await harness.run((state) => {
      state.sessionStartModal?.onOpenChange(false);
    });

    await harness.waitFor(
      (state) =>
        state.sessionStartModal === null &&
        state.humanReviewFeedbackModal?.open === true &&
        state.humanReviewFeedbackModal.message === "Keep this request-changes draft.",
    );

    await harness.unmount();
  });

  test("onOpenSession uses explicit session identity when provided", async () => {
    const args = createBaseArgs();
    const harness = createHookHarness(args);

    await harness.mount();
    await harness.run((state) => {
      state.onOpenSession("TASK-1", "build", {
        session: sessionIdentity("builder-session-1"),
      });
    });

    expect(args.navigate).toHaveBeenCalledWith(
      agentStudioSessionUrl("TASK-1", "build", sessionIdentity("builder-session-1")),
    );

    await harness.unmount();
  });

  test("onOpenSession uses explicit session identity even when it is not currently loaded", async () => {
    const args = createBaseArgs();
    const harness = createHookHarness(args);

    await harness.mount();
    await harness.run((state) => {
      state.onOpenSession("TASK-1", "build", {
        session: sessionIdentity("builder-session-archived"),
      });
    });

    expect(args.navigate).toHaveBeenCalledWith(
      agentStudioSessionUrl("TASK-1", "build", sessionIdentity("builder-session-archived")),
    );

    await harness.unmount();
  });

  test("onOpenSession uses latest role session when explicit id is absent", async () => {
    const args = createBaseArgs();
    const harness = createHookHarness(args);

    await harness.mount();
    await harness.run((state) => {
      state.onOpenSession("TASK-1", "build");
    });

    expect(args.navigate).toHaveBeenCalledWith(
      agentStudioSessionUrl("TASK-1", "build", sessionIdentity("builder-session-2")),
    );

    await harness.unmount();
  });

  test("onOpenSession follows the updated session render snapshot", async () => {
    const args = createBaseArgs();
    args.sessions = [
      createAgentSessionSummaryFixture({
        externalSessionId: "builder-session-before-refresh",
        taskId: "TASK-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/builder-session-before-refresh",
        role: "build",
        startedAt: "2026-03-19T12:00:00.000Z",
      }),
    ];
    const nextSession = createAgentSessionSummaryFixture({
      externalSessionId: "builder-session-after-refresh",
      taskId: "TASK-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/builder-session-after-refresh",
      role: "build",
      startedAt: "2026-03-20T12:00:00.000Z",
    });
    const harness = createHookHarness(args);

    await harness.mount();
    await harness.update({
      ...args,
      sessions: [nextSession],
    });
    await harness.run((state) => {
      state.onOpenSession("TASK-1", "build");
    });

    expect(args.navigate).toHaveBeenCalledWith(
      agentStudioSessionUrl("TASK-1", "build", nextSession),
    );

    await harness.unmount();
  });

  test("onOpenSession falls back to agent only when no matching session exists", async () => {
    const args = createBaseArgs();
    args.sessions = [];
    const harness = createHookHarness(args);

    await harness.mount();
    await harness.run((state) => {
      state.onOpenSession("TASK-404", "qa");
    });

    expect(args.navigate).toHaveBeenCalledWith("/agents?task=TASK-404&agent=qa");

    await harness.unmount();
  });

  test("onOpenSession prefers waiting-input session before latest-by-time fallback", async () => {
    const args = createBaseArgs();
    args.sessions = [
      createAgentSessionSummaryFixture({
        externalSessionId: "builder-session-new-running",
        taskId: "TASK-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/builder-session-new-running",
        role: "build",
        status: "running",
        pendingApprovals: [],
        pendingQuestions: [],
        startedAt: "2026-03-20T12:00:00.000Z",
      }),
      createAgentSessionSummaryFixture({
        externalSessionId: "builder-session-old-waiting",
        taskId: "TASK-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/builder-session-old-waiting",
        role: "build",
        status: "idle",
        pendingApprovals: [],
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
      state.onOpenSession("TASK-1", "build");
    });

    const waitingSession = args.sessions[1];
    if (!waitingSession) {
      throw new Error("Expected waiting-input fixture session");
    }
    expect(args.navigate).toHaveBeenCalledWith(
      agentStudioSessionUrl("TASK-1", "build", waitingSession),
    );

    await harness.unmount();
  });
});
