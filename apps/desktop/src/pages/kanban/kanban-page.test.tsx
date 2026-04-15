import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RepoConfig,
  type RepoPromptOverrides,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { type RenderResult, render, waitFor } from "@testing-library/react";
import { act, isValidElement, type ReactElement } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { clearAppQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import { RuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { host } from "@/state/operations/host";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import type { AgentSessionLoadOptions } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  createBeadsCheckFixture,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "../agents/agent-studio-test-utils";

enableReactActEnvironment();

const originalConsoleError = console.error;
const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;
const originalTasksList = host.tasksList;
const originalBuildContinuationTargetGet = host.buildContinuationTargetGet;

const startAgentSessionMock = mock(async () => "session-1");
const sendAgentMessageMock = mock(async () => {});
const updateAgentSessionModelMock = mock(() => {});
const bootstrapTaskSessionsMock = mock(async (_taskId: string) => {});
const hydrateRequestedTaskSessionHistoryMock = mock(
  async (_input: { taskId: string; sessionId: string }) => {},
);
const loadAgentSessionsMock = mock(
  async (_taskId: string, _options?: AgentSessionLoadOptions) => {},
);
const removeAgentSessionsMock = mock(
  (_input: { taskId: string; roles?: Array<"spec" | "planner" | "build" | "qa"> }) => {},
);
const humanApproveTaskMock = mock(async () => {});
const humanRequestChangesTaskMock = mock(async () => {});
const deleteTaskMock = mock(async () => {});
const resetTaskImplementationMock = mock(async () => {});
const resetTaskMock = mock(async () => {});
const deferTaskMock = mock(async () => {});
const resumeDeferredTaskMock = mock(async () => {});
const toastSuccessMock = mock(() => {});
const toastErrorMock = mock(() => {});
const workspaceGetRepoConfigMock = mock(async (): Promise<RepoConfig> => createRepoConfigFixture());
const workspaceGetSettingsSnapshotMock = mock(async () => ({
  theme: "light" as const,
  git: {
    defaultMergeMethod: "merge_commit" as const,
  },
  chat: {
    showThinkingMessages: false,
  },
  kanban: {
    doneVisibleDays: 1,
  },
  autopilot: {
    rules: [],
  },
  workspaces: {},
  globalPromptOverrides: {} as RepoPromptOverrides,
}));
const tasksListMock = mock(async () => [currentTaskFixture]);
const buildContinuationTargetGetMock = mock(async () => ({
  workingDirectory: "/repo/worktrees/task-1",
  source: "builder_session" as const,
}));
const loadRepoRuntimeCatalogMock = mock(
  async (): Promise<AgentModelCatalog> => ({
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
        name: "spec-agent",
        mode: "primary",
        hidden: false,
        color: "#f59e0b",
      },
      {
        name: "build-agent",
        mode: "primary",
        hidden: false,
      },
    ],
  }),
);

let latestKanbanColumnProps: Record<string, unknown> | null = null;
let latestKanbanColumnPropsList: Record<string, unknown>[] = [];
let latestHumanReviewFeedbackModalModel: Record<string, unknown> | null = null;
let latestSessionStartModalModel: Record<string, unknown> | null = null;
let latestResetImplementationModalModel: Record<string, unknown> | null = null;
let latestMergedPullRequestModalProps: Record<string, unknown> | null = null;
let latestLocation = "/";
let currentPendingMergedPullRequest: {
  taskId: string;
  pullRequest: {
    providerId: string;
    number: number;
    url: string;
    state: "merged";
    createdAt: string;
    updatedAt: string;
    lastSyncedAt: string;
    mergedAt: string;
    closedAt: string;
  };
} | null = null;
let currentLinkingMergedPullRequestTaskId: string | null = null;
const RUNTIME_DEFINITIONS = [OPENCODE_RUNTIME_DESCRIPTOR] as const;

let currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "open" });
let currentSessionsFixture = [
  {
    runtimeKind: "opencode",
    sessionId: "session-spec",
    taskId: "TASK-123",
    role: "spec",
    scenario: "spec_initial",
    status: "running",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pendingPermissions: 0,
    pendingQuestions: 0,
  },
  {
    runtimeKind: "opencode",
    sessionId: "session-build-older",
    taskId: "TASK-123",
    role: "build",
    scenario: "build_after_human_request_changes",
    status: "running",
    startedAt: "2026-01-01T12:00:00.000Z",
    updatedAt: "2026-01-01T12:00:00.000Z",
    pendingPermissions: 0,
    pendingQuestions: 0,
  },
  {
    runtimeKind: "opencode",
    sessionId: "session-build-latest",
    taskId: "TASK-123",
    role: "build",
    scenario: "build_implementation_start",
    status: "idle",
    startedAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    pendingPermissions: 0,
    pendingQuestions: 0,
  },
];

const REPO_SETTINGS_FIXTURE: RepoSettingsInput = {
  defaultRuntimeKind: "opencode" as const,
  worktreeBasePath: "",
  branchPrefix: "codex/",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  trustedHooks: false,
  preStartHooks: [],
  postCompleteHooks: [],
  devServers: [],
  worktreeFileCopies: [],
  agentDefaults: {
    spec: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    },
    planner: null,
    build: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "build-agent",
    },
    qa: null,
  },
};

const createRepoConfigFixture = (promptOverrides: RepoPromptOverrides = {}): RepoConfig => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "opencode",
  worktreeBasePath: undefined,
  branchPrefix: "codex/",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {
    providers: {},
  },
  trustedHooks: false,
  trustedHooksFingerprint: undefined,
  hooks: {
    preStart: [],
    postComplete: [],
  },
  devServers: [],
  worktreeFileCopies: [],
  promptOverrides,
  agentDefaults: {
    spec: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    },
    planner: undefined,
    build: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "build-agent",
    },
    qa: undefined,
  },
});

const renderPage = async (options?: { waitForKanbanReady?: boolean }): Promise<RenderResult> => {
  const { KanbanPage } = await import("./kanban-page");
  const LocationProbe = (): ReactElement | null => {
    const location = useLocation();
    latestLocation = `${location.pathname}${location.search}`;
    return null;
  };

  const renderer = render(
    <QueryProvider useIsolatedClient>
      <RuntimeDefinitionsContext.Provider
        value={{
          runtimeDefinitions: [...RUNTIME_DEFINITIONS],
          isLoadingRuntimeDefinitions: false,
          runtimeDefinitionsError: null,
          refreshRuntimeDefinitions: async () => [...RUNTIME_DEFINITIONS],
          loadRepoRuntimeCatalog: loadRepoRuntimeCatalogMock,
          loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
          loadRepoRuntimeFileSearch: async () => [],
        }}
      >
        <MemoryRouter initialEntries={["/"]}>
          <LocationProbe />
          <KanbanPage />
        </MemoryRouter>
      </RuntimeDefinitionsContext.Provider>
    </QueryProvider>,
  );

  if (options?.waitForKanbanReady !== false) {
    await waitFor(() => {
      const totalTaskCount = latestKanbanColumnPropsList.reduce((count, props) => {
        const column = props.column as { tasks: unknown[] };
        return count + column.tasks.length;
      }, 0);
      expect(totalTaskCount).toBeGreaterThan(0);
    });
  }

  return renderer;
};

const waitForMockCall = async (
  fn: { mock: { calls: unknown[][] } },
  minCalls = 1,
): Promise<void> => {
  await waitFor(() => {
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(minCalls);
  });
};

const waitForSessionStartModalReady = async (): Promise<void> => {
  await waitFor(() => {
    expect(latestSessionStartModalModel).toBeTruthy();
    expect(latestSessionStartModalModel?.isSelectionCatalogLoading).not.toBe(true);
  });
};

const confirmSessionStartModal = async (input?: {
  runInBackground?: boolean;
  startMode?: "fresh" | "reuse" | "fork";
  sourceSessionId?: string | null;
  modelId?: string;
  profileId?: string;
  variant?: string;
}): Promise<void> => {
  await waitForSessionStartModalReady();

  await act(async () => {
    if (input?.modelId) {
      (latestSessionStartModalModel?.onSelectModel as ((value: string) => void) | undefined)?.(
        input.modelId,
      );
    }
    if (input?.profileId) {
      (latestSessionStartModalModel?.onSelectAgent as ((value: string) => void) | undefined)?.(
        input.profileId,
      );
    }
    if (input?.variant) {
      (latestSessionStartModalModel?.onSelectVariant as ((value: string) => void) | undefined)?.(
        input.variant,
      );
    }
    (
      latestSessionStartModalModel?.onConfirm as
        | ((value: {
            runInBackground?: boolean;
            startMode?: "fresh" | "reuse" | "fork";
            sourceSessionId?: string | null;
          }) => void)
        | undefined
    )?.({
      runInBackground: input?.runInBackground ?? false,
      startMode: input?.startMode ?? "fresh",
      sourceSessionId: input?.sourceSessionId ?? null,
    });
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("KanbanPage session start modal flow", () => {
  beforeEach(() => {
    mock.module("sonner", () => ({
      toast: {
        success: toastSuccessMock,
        error: toastErrorMock,
      },
    }));

    mock.module("@/components/features/kanban/kanban-column", () => ({
      KanbanColumn: (props: Record<string, unknown>): ReactElement | null => {
        latestKanbanColumnProps = props;
        latestKanbanColumnPropsList.push(props);
        return null;
      },
    }));

    mock.module("./kanban-session-start-modal", () => ({
      KanbanSessionStartModal: ({
        model,
      }: {
        model: Record<string, unknown>;
      }): ReactElement | null => {
        latestSessionStartModalModel = model;
        return null;
      },
    }));

    mock.module("@/components/features/pull-requests/merged-pull-request-confirm-dialog", () => ({
      MergedPullRequestConfirmDialog: (props: Record<string, unknown>): ReactElement | null => {
        latestMergedPullRequestModalProps = props;
        return null;
      },
    }));

    mock.module("./task-reset-implementation-modal", () => ({
      TaskResetImplementationModal: ({
        model,
      }: {
        model: Record<string, unknown> | null;
      }): ReactElement | null => {
        latestResetImplementationModalModel = model;
        return null;
      },
    }));

    mock.module("@/features/human-review-feedback/human-review-feedback-modal", () => ({
      HumanReviewFeedbackModal: ({
        model,
      }: {
        model: Record<string, unknown> | null;
      }): ReactElement | null => {
        latestHumanReviewFeedbackModalModel = model;
        return null;
      },
    }));

    const stateModule = {
      AppStateProvider: ({ children }: { children: ReactElement }): ReactElement => children,
      useAgentState: () => {
        throw new Error("useAgentState is not used in this test");
      },
      useAgentSessions: () => {
        throw new Error("useAgentSessions is not used in this test");
      },
      useAgentSession: () => {
        throw new Error("useAgentSession is not used in this test");
      },
      useWorkspaceState: () => ({
        activeRepo: "/repo",
        isSwitchingWorkspace: false,
        loadRepoSettings: async () => REPO_SETTINGS_FIXTURE,
      }),
      useAgentSessionSummaries: () => currentSessionsFixture,
      useAgentOperations: () => ({
        bootstrapTaskSessions: bootstrapTaskSessionsMock,
        hydrateRequestedTaskSessionHistory: hydrateRequestedTaskSessionHistoryMock,
        loadAgentSessions: loadAgentSessionsMock,
        removeAgentSessions: removeAgentSessionsMock,
        startAgentSession: startAgentSessionMock,
        sendAgentMessage: sendAgentMessageMock,
      }),
      useTasksState: () => ({
        isForegroundLoadingTasks: false,
        isRefreshingTasksInBackground: false,
        tasks: [currentTaskFixture],
        runs: [],
        isLoadingTasks: false,
        createTask: async () => {},
        updateTask: async () => {},
        refreshTasks: async () => {},
        syncPullRequests: async () => {},
        linkMergedPullRequest: async () => {},
        cancelLinkMergedPullRequest: () => {},
        unlinkPullRequest: async () => {},
        detectingPullRequestTaskId: null,
        linkingMergedPullRequestTaskId: currentLinkingMergedPullRequestTaskId,
        unlinkingPullRequestTaskId: null,
        pendingMergedPullRequest: currentPendingMergedPullRequest,
        deleteTask: deleteTaskMock,
        resetTaskImplementation: resetTaskImplementationMock,
        resetTask: resetTaskMock,
        transitionTask: async () => {},
        deferTask: deferTaskMock,
        resumeDeferredTask: resumeDeferredTaskMock,
        humanApproveTask: humanApproveTaskMock,
        humanRequestChangesTask: humanRequestChangesTaskMock,
      }),
      useChecksState: () => ({
        beadsCheck: createBeadsCheckFixture(
          {},
          {
            beadsPath: "/tmp/beads.db",
            repoStoreHealth: {
              attachment: {
                path: "/tmp/beads.db",
              },
            },
          },
        ),
      }),
      useDelegationState: () => ({}),
      useSpecState: () => ({}),
    };
    mock.module("@/state/app-state-provider", () => stateModule);
  });

  beforeEach(async () => {
    await clearAppQueryClient();
    host.workspaceGetRepoConfig = workspaceGetRepoConfigMock as typeof host.workspaceGetRepoConfig;
    host.workspaceGetSettingsSnapshot =
      workspaceGetSettingsSnapshotMock as typeof host.workspaceGetSettingsSnapshot;
    host.tasksList = tasksListMock as typeof host.tasksList;
    host.buildContinuationTargetGet =
      buildContinuationTargetGetMock as typeof host.buildContinuationTargetGet;
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "open" });
    currentSessionsFixture = [
      {
        runtimeKind: "opencode",
        sessionId: "session-spec",
        taskId: "TASK-123",
        role: "spec",
        scenario: "spec_initial",
        status: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        pendingPermissions: 0,
        pendingQuestions: 0,
      },
      {
        runtimeKind: "opencode",
        sessionId: "session-build-older",
        taskId: "TASK-123",
        role: "build",
        scenario: "build_after_human_request_changes",
        status: "running",
        startedAt: "2026-01-01T12:00:00.000Z",
        updatedAt: "2026-01-01T12:00:00.000Z",
        pendingPermissions: 0,
        pendingQuestions: 0,
      },
      {
        runtimeKind: "opencode",
        sessionId: "session-build-latest",
        taskId: "TASK-123",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        pendingPermissions: 0,
        pendingQuestions: 0,
      },
    ];
    latestKanbanColumnProps = null;
    latestKanbanColumnPropsList = [];
    latestHumanReviewFeedbackModalModel = null;
    latestSessionStartModalModel = null;
    latestResetImplementationModalModel = null;
    latestMergedPullRequestModalProps = null;
    latestLocation = "/";
    currentPendingMergedPullRequest = null;
    currentLinkingMergedPullRequestTaskId = null;
    startAgentSessionMock.mockClear();
    sendAgentMessageMock.mockClear();
    updateAgentSessionModelMock.mockClear();
    bootstrapTaskSessionsMock.mockClear();
    hydrateRequestedTaskSessionHistoryMock.mockClear();
    loadAgentSessionsMock.mockClear();
    removeAgentSessionsMock.mockClear();
    humanApproveTaskMock.mockClear();
    humanRequestChangesTaskMock.mockClear();
    deleteTaskMock.mockClear();
    resetTaskImplementationMock.mockClear();
    resetTaskMock.mockClear();
    deferTaskMock.mockClear();
    resumeDeferredTaskMock.mockClear();
    toastSuccessMock.mockClear();
    toastErrorMock.mockClear();
    workspaceGetRepoConfigMock.mockClear();
    workspaceGetSettingsSnapshotMock.mockClear();
    tasksListMock.mockClear();
    buildContinuationTargetGetMock.mockClear();
    loadRepoRuntimeCatalogMock.mockClear();
    workspaceGetRepoConfigMock.mockImplementation(async () => createRepoConfigFixture());
    workspaceGetSettingsSnapshotMock.mockImplementation(async () => ({
      theme: "light" as const,
      git: {
        defaultMergeMethod: "merge_commit" as const,
      },
      chat: {
        showThinkingMessages: false,
      },
      kanban: {
        doneVisibleDays: 1,
      },
      autopilot: {
        rules: [],
      },
      workspaces: {},
      globalPromptOverrides: {},
    }));
    tasksListMock.mockImplementation(async () => [currentTaskFixture]);
  });

  afterEach(() => {
    host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
    host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
    host.tasksList = originalTasksList;
    host.buildContinuationTargetGet = originalBuildContinuationTargetGet;
  });

  afterAll(async () => {
    console.error = originalConsoleError;
    await restoreMockedModules([
      ["sonner", () => import("sonner")],
      [
        "@/components/features/kanban/kanban-column",
        () => import("@/components/features/kanban/kanban-column"),
      ],
      ["./kanban-session-start-modal", () => import("./kanban-session-start-modal")],
      [
        "@/components/features/pull-requests/merged-pull-request-confirm-dialog",
        () => import("@/components/features/pull-requests/merged-pull-request-confirm-dialog"),
      ],
      ["./task-reset-implementation-modal", () => import("./task-reset-implementation-modal")],
      [
        "@/features/human-review-feedback/human-review-feedback-modal",
        () => import("@/features/human-review-feedback/human-review-feedback-modal"),
      ],
      ["@/state/app-state-provider", () => import("@/state/app-state-provider")],
    ]);
  });

  test("delegate action opens modal and foreground confirm navigates to Agent Studio", async () => {
    const renderer = await renderPage({ waitForKanbanReady: false });

    expect(latestKanbanColumnProps).toBeTruthy();

    await act(async () => {
      (latestKanbanColumnProps?.onDelegate as (taskId: string) => void)("TASK-123");
    });

    expect(latestSessionStartModalModel?.open).toBe(true);

    await confirmSessionStartModal({
      modelId: "openai/gpt-5",
      profileId: "build-agent",
      variant: "default",
    });

    await waitForMockCall(startAgentSessionMock);

    expect(startAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "TASK-123",
        role: "build",
        scenario: "build_implementation_start",
        startMode: "fresh",
      }),
    );
    expect(updateAgentSessionModelMock).not.toHaveBeenCalled();
    expect(latestLocation).toContain("/agents?task=TASK-123");

    await act(async () => {
      renderer.unmount();
    });
  });

  test("settings load failure reports an error and leaves the Kanban board empty", async () => {
    workspaceGetSettingsSnapshotMock.mockImplementationOnce(async () => {
      throw new Error("settings unavailable");
    });

    const renderer = await renderPage({ waitForKanbanReady: false });

    await waitForMockCall(toastErrorMock);

    expect(toastErrorMock).toHaveBeenCalledWith("Failed to load Kanban settings", {
      description: "settings unavailable",
    });
    expect(tasksListMock).not.toHaveBeenCalled();
    expect(
      latestKanbanColumnPropsList.reduce((count, props) => {
        const column = props.column as { tasks: unknown[] };
        return count + column.tasks.length;
      }, 0),
    ).toBe(0);

    await act(async () => {
      renderer.unmount();
    });
  });

  test("kanban task load failure reports an error and does not reuse shared task state", async () => {
    tasksListMock.mockImplementationOnce(async () => {
      throw new Error("tasks unavailable");
    });

    const renderer = await renderPage({ waitForKanbanReady: false });

    await waitForMockCall(toastErrorMock);

    expect(toastErrorMock).toHaveBeenCalledWith("Failed to load Kanban tasks", {
      description: "tasks unavailable",
    });
    expect(tasksListMock).toHaveBeenCalledWith("/repo", 1);
    expect(
      latestKanbanColumnPropsList.reduce((count, props) => {
        const column = props.column as { tasks: unknown[] };
        return count + column.tasks.length;
      }, 0),
    ).toBe(0);

    await act(async () => {
      renderer.unmount();
    });
  });

  test("background confirm keeps user on Kanban and shows background success toast", async () => {
    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onDelegate as (taskId: string) => void)("TASK-123");
    });

    await confirmSessionStartModal({
      runInBackground: true,
      modelId: "openai/gpt-5",
      profileId: "build-agent",
      variant: "default",
    });
    await waitForMockCall(sendAgentMessageMock);

    expect(startAgentSessionMock).toHaveBeenCalledTimes(1);
    expect(updateAgentSessionModelMock).not.toHaveBeenCalled();
    expect(sendAgentMessageMock).toHaveBeenCalledTimes(1);
    expect(latestLocation).toBe("/");
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Started Builder session in background for TASK-123.",
      expect.objectContaining({
        duration: 10000,
      }),
    );
    const toastCall = toastSuccessMock.mock.calls.at(0) as
      | [string, { description?: unknown }?]
      | undefined;
    const toastDescription = toastCall?.[1]?.description;
    expect(isValidElement(toastDescription)).toBe(true);
    if (!isValidElement(toastDescription)) {
      throw new Error("Expected background toast description to render an action element.");
    }
    const toastDescriptionRender = render(toastDescription);
    const actionButton = toastDescriptionRender.container.querySelector("button");
    if (!actionButton) {
      throw new Error("Expected background toast action button.");
    }
    await act(async () => {
      actionButton.click();
      await Promise.resolve();
    });
    expect(latestLocation).toContain("/agents?task=TASK-123");
    expect(latestLocation).toContain("session=session-1");
    expect(latestLocation).toContain("agent=build");

    toastDescriptionRender.unmount();

    await act(async () => {
      renderer.unmount();
    });
  });

  test("reuse confirm does not overwrite the reused session model", async () => {
    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onDelegate as (taskId: string) => void)("TASK-123");
    });

    await act(async () => {
      (
        latestSessionStartModalModel?.onConfirm as (input: {
          runInBackground?: boolean;
          startMode?: "fresh" | "reuse" | "fork";
          sourceSessionId?: string | null;
        }) => void
      )({
        startMode: "reuse",
        sourceSessionId: "session-existing",
      });
      await Promise.resolve();
    });

    expect(startAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "TASK-123",
        role: "build",
        scenario: "build_implementation_start",
        startMode: "reuse",
        sourceSessionId: "session-existing",
      }),
    );
    expect(updateAgentSessionModelMock).not.toHaveBeenCalled();

    await act(async () => {
      renderer.unmount();
    });
  });

  test("background kickoff pending does not keep modal in loading state on next open", async () => {
    let resolveKickoff: (() => void) | null = null;
    sendAgentMessageMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveKickoff = resolve;
        }),
    );

    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onDelegate as (taskId: string) => void)("TASK-123");
    });

    await confirmSessionStartModal({
      runInBackground: true,
      modelId: "openai/gpt-5",
      profileId: "build-agent",
      variant: "default",
    });

    await act(async () => {
      (latestKanbanColumnProps?.onDelegate as (taskId: string) => void)("TASK-123");
    });

    expect(latestSessionStartModalModel?.isStarting).toBe(false);

    if (resolveKickoff) {
      await act(async () => {
        resolveKickoff?.();
        await Promise.resolve();
      });
    }

    await act(async () => {
      renderer.unmount();
    });
  });

  test("kickoff send failure still reports kickoff error after session start", async () => {
    sendAgentMessageMock.mockImplementationOnce(async () => {
      throw new Error("config unavailable");
    });

    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onDelegate as (taskId: string) => void)("TASK-123");
    });

    await confirmSessionStartModal({
      modelId: "openai/gpt-5",
      profileId: "build-agent",
      variant: "default",
    });

    expect(startAgentSessionMock).toHaveBeenCalledTimes(1);
    expect(sendAgentMessageMock).toHaveBeenCalledTimes(1);
    expect(latestLocation).toContain("/agents?task=TASK-123");
    await waitForMockCall(toastErrorMock);
    expect(toastErrorMock).toHaveBeenCalledWith("Session started, but kickoff message failed.", {
      description: "config unavailable",
    });
    expect(toastErrorMock).not.toHaveBeenCalledWith("Failed to start the session.");

    await act(async () => {
      renderer.unmount();
    });
  });

  test("session start failure shows a single modal-level error toast", async () => {
    startAgentSessionMock.mockImplementationOnce(async () => {
      throw new Error("Worktree path already exists for task TASK-123");
    });

    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onDelegate as (taskId: string) => void)("TASK-123");
    });

    await confirmSessionStartModal({
      modelId: "openai/gpt-5",
      profileId: "build-agent",
      variant: "default",
    });

    await waitForMockCall(startAgentSessionMock);
    await waitForMockCall(toastErrorMock);
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith("Failed to start the session.", {
      description: "Worktree path already exists for task TASK-123",
    });
    expect(latestLocation).toBe("/");

    await act(async () => {
      renderer.unmount();
    });
  });

  test("malformed kickoff override still reports kickoff error after session start", async () => {
    workspaceGetRepoConfigMock.mockImplementation(async () => {
      return createRepoConfigFixture({
        "kickoff.build_implementation_start": {
          template: "Kickoff {{unsupported.token}}",
          baseVersion: 1,
        },
      });
    });

    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onDelegate as (taskId: string) => void)("TASK-123");
    });

    await confirmSessionStartModal({
      modelId: "openai/gpt-5",
      profileId: "build-agent",
      variant: "default",
    });

    expect(startAgentSessionMock).toHaveBeenCalledTimes(1);
    expect(sendAgentMessageMock).not.toHaveBeenCalled();
    expect(latestLocation).toContain("/agents?task=TASK-123");
    await waitForMockCall(toastErrorMock);
    expect(toastErrorMock).toHaveBeenCalledWith("Session started, but kickoff message failed.", {
      description:
        'Prompt template "kickoff.build_implementation_start" uses unsupported placeholder "unsupported.token".',
    });
    expect(toastErrorMock).not.toHaveBeenCalledWith("Failed to start the session.");

    await act(async () => {
      renderer.unmount();
    });
  });

  test("modal model edits are propagated to session start payload", async () => {
    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onDelegate as (taskId: string) => void)("TASK-123");
    });

    await act(async () => {
      (latestSessionStartModalModel?.onSelectModel as (value: string) => void)("openai/gpt-5");
      (latestSessionStartModalModel?.onSelectAgent as (value: string) => void)("build-agent");
      (latestSessionStartModalModel?.onSelectVariant as (value: string) => void)("default");
    });

    await confirmSessionStartModal({
      modelId: "openai/gpt-5",
      profileId: "build-agent",
      variant: "default",
    });

    expect(startAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "default",
          profileId: "build-agent",
        },
      }),
    );

    await act(async () => {
      renderer.unmount();
    });
  });

  test("continue spec action navigates to latest spec session without opening modal", async () => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "spec_ready" });
    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onPlan as (taskId: string, action: string) => void)(
        "TASK-123",
        "set_spec",
      );
    });

    expect(latestSessionStartModalModel).toBeNull();
    expect(startAgentSessionMock).not.toHaveBeenCalled();
    expect(latestLocation).toContain("/agents?task=TASK-123");
    expect(latestLocation).toContain("session=session-spec");

    await act(async () => {
      renderer.unmount();
    });
  });

  test("keeps human request changes handler stable across modal state re-renders", async () => {
    const renderer = await renderPage();

    const initialOnHumanRequestChanges = latestKanbanColumnProps?.onHumanRequestChanges;
    expect(initialOnHumanRequestChanges).toBeDefined();

    await act(async () => {
      (latestKanbanColumnProps?.onDelegate as (taskId: string) => void)("TASK-123");
    });

    const nextOnHumanRequestChanges = latestKanbanColumnProps?.onHumanRequestChanges;
    expect(nextOnHumanRequestChanges).toBe(initialOnHumanRequestChanges);

    await act(async () => {
      renderer.unmount();
    });
  });

  test("human request changes opens dedicated feedback modal before mutating", async () => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "human_review" });
    const renderer = await renderPage();

    await act(async () => {
      await (latestKanbanColumnProps?.onHumanRequestChanges as (taskId: string) => Promise<void>)(
        "TASK-123",
      );
    });

    expect(bootstrapTaskSessionsMock).not.toHaveBeenCalled();
    expect(humanRequestChangesTaskMock).not.toHaveBeenCalled();
    expect(latestHumanReviewFeedbackModalModel?.open).toBe(true);
    expect(latestHumanReviewFeedbackModalModel?.message).toBe("");
    expect(latestSessionStartModalModel).toBeNull();

    await act(async () => {
      renderer.unmount();
    });
  });

  test("human request changes opens the shared start modal with reuse selected by default", async () => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "human_review" });
    const renderer = await renderPage();

    await act(async () => {
      await (latestKanbanColumnProps?.onHumanRequestChanges as (taskId: string) => Promise<void>)(
        "TASK-123",
      );
    });

    await act(async () => {
      (latestHumanReviewFeedbackModalModel?.onMessageChange as (message: string) => void)(
        "Apply the requested human review changes.",
      );
    });

    await act(async () => {
      void (
        latestHumanReviewFeedbackModalModel?.onConfirm as (() => Promise<void>) | undefined
      )?.();
      await Promise.resolve();
    });

    await waitForSessionStartModalReady();

    expect(bootstrapTaskSessionsMock).not.toHaveBeenCalled();
    expect(startAgentSessionMock).not.toHaveBeenCalled();
    expect(humanRequestChangesTaskMock).not.toHaveBeenCalled();
    expect(sendAgentMessageMock).not.toHaveBeenCalled();
    expect(latestSessionStartModalModel?.open).toBe(true);
    expect(latestSessionStartModalModel?.selectedStartMode).toBe("reuse");
    expect(latestSessionStartModalModel?.selectedSourceSessionId).toBe("session-build-latest");
    expect(latestSessionStartModalModel?.existingSessionOptions).toEqual([
      expect.objectContaining({ value: "session-build-latest" }),
      expect.objectContaining({ value: "session-build-older" }),
    ]);

    await act(async () => {
      renderer.unmount();
    });
  });

  test("human request changes opens the shared start modal in fresh mode when no builder session exists", async () => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "human_review" });
    const [specSession] = currentSessionsFixture;
    expect(specSession).toBeDefined();
    currentSessionsFixture = specSession ? [specSession] : [];
    const sessionsBeforeBootstrap = currentSessionsFixture;
    bootstrapTaskSessionsMock.mockImplementationOnce(async () => {
      currentSessionsFixture = sessionsBeforeBootstrap;
    });
    const renderer = await renderPage();

    await act(async () => {
      await (latestKanbanColumnProps?.onHumanRequestChanges as (taskId: string) => Promise<void>)(
        "TASK-123",
      );
    });

    expect(latestHumanReviewFeedbackModalModel?.open).toBe(true);

    await act(async () => {
      (latestHumanReviewFeedbackModalModel?.onMessageChange as (message: string) => void)(
        "Use a fresh builder session for these changes.",
      );
    });

    await act(async () => {
      void (
        latestHumanReviewFeedbackModalModel?.onConfirm as (() => Promise<void>) | undefined
      )?.();
      await Promise.resolve();
    });

    await waitForSessionStartModalReady();

    expect(latestSessionStartModalModel?.open).toBe(true);
    expect(latestSessionStartModalModel?.selectedStartMode).toBe("fresh");
    expect(latestSessionStartModalModel?.existingSessionOptions).toEqual([]);

    await act(async () => {
      renderer.unmount();
    });
  });

  test("canceling request-changes session selection restores the feedback draft", async () => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "human_review" });
    const renderer = await renderPage();

    await act(async () => {
      await (latestKanbanColumnProps?.onHumanRequestChanges as (taskId: string) => Promise<void>)(
        "TASK-123",
      );
    });

    await act(async () => {
      (latestHumanReviewFeedbackModalModel?.onMessageChange as (message: string) => void)(
        "Keep this request-changes draft.",
      );
    });

    await act(async () => {
      void (
        latestHumanReviewFeedbackModalModel?.onConfirm as (() => Promise<void>) | undefined
      )?.();
      await Promise.resolve();
    });

    await waitForSessionStartModalReady();

    expect(latestSessionStartModalModel?.open).toBe(true);

    await act(async () => {
      (latestSessionStartModalModel?.onOpenChange as (open: boolean) => void)(false);
    });

    await waitFor(() => {
      expect(latestSessionStartModalModel).toBeNull();
      expect(latestHumanReviewFeedbackModalModel?.open).toBe(true);
      expect(latestHumanReviewFeedbackModalModel?.message).toBe("Keep this request-changes draft.");
    });

    await act(async () => {
      renderer.unmount();
    });
  });

  test("reset implementation prunes local build and qa sessions before reloading persisted sessions", async () => {
    currentTaskFixture = createTaskCardFixture({
      id: "TASK-123",
      status: "in_progress",
      availableActions: ["reset_implementation"],
    });
    currentSessionsFixture = [
      {
        runtimeKind: "opencode",
        sessionId: "session-build-idle",
        taskId: "TASK-123",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        pendingPermissions: 0,
        pendingQuestions: 0,
      },
      {
        runtimeKind: "opencode",
        sessionId: "session-qa-stopped",
        taskId: "TASK-123",
        role: "qa",
        scenario: "qa_review",
        status: "stopped",
        startedAt: "2026-01-03T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
        pendingPermissions: 0,
        pendingQuestions: 0,
      },
    ];
    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onResetImplementation as (taskId: string) => void)("TASK-123");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latestResetImplementationModalModel?.open).toBe(true);

    await act(async () => {
      (latestResetImplementationModalModel?.onConfirm as () => void)();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForMockCall(loadAgentSessionsMock);

    expect(resetTaskImplementationMock).toHaveBeenCalledWith("TASK-123");
    expect(removeAgentSessionsMock).toHaveBeenCalledWith({
      taskId: "TASK-123",
      roles: ["build", "qa"],
    });
    expect(loadAgentSessionsMock).toHaveBeenCalledWith("TASK-123");

    const removeCallOrder = removeAgentSessionsMock.mock.invocationCallOrder[0];
    const loadCallOrder = loadAgentSessionsMock.mock.invocationCallOrder[0];
    expect(removeCallOrder).toBeDefined();
    expect(loadCallOrder).toBeDefined();
    if (removeCallOrder !== undefined && loadCallOrder !== undefined) {
      expect(removeCallOrder).toBeLessThan(loadCallOrder);
    }

    await act(async () => {
      renderer.unmount();
    });
  });

  test("reset implementation reports session refresh failures after a successful reset", async () => {
    currentTaskFixture = createTaskCardFixture({
      id: "TASK-123",
      status: "in_progress",
      availableActions: ["reset_implementation"],
    });
    currentSessionsFixture = [
      {
        runtimeKind: "opencode",
        sessionId: "session-build-idle",
        taskId: "TASK-123",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        pendingPermissions: 0,
        pendingQuestions: 0,
      },
    ];
    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onResetImplementation as (taskId: string) => void)("TASK-123");
      await Promise.resolve();
      await Promise.resolve();
    });

    loadAgentSessionsMock.mockClear();
    loadAgentSessionsMock.mockImplementationOnce(async () => {
      throw new Error("refresh failed");
    });

    await act(async () => {
      (latestResetImplementationModalModel?.onConfirm as () => void)();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForMockCall(loadAgentSessionsMock);

    expect(toastErrorMock).toHaveBeenCalledWith("Failed to refresh sessions", {
      description: "refresh failed",
    });

    await act(async () => {
      renderer.unmount();
    });
  });

  test("reset implementation reports a missing task instead of silently returning", async () => {
    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onResetImplementation as (taskId: string) => void)("MISSING-1");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toastErrorMock).toHaveBeenCalledWith("Unable to reset implementation", {
      description: "Task MISSING-1 was not found. Refresh tasks and try again.",
    });
    expect(latestResetImplementationModalModel).toBeNull();

    await act(async () => {
      renderer.unmount();
    });
  });

  test("build action bypasses modal and navigates directly", async () => {
    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onBuild as (taskId: string) => void)("TASK-123");
    });

    expect(latestSessionStartModalModel).toBeNull();
    expect(startAgentSessionMock).not.toHaveBeenCalled();
    expect(latestLocation).toContain("/agents?task=TASK-123");
    expect(latestLocation).toContain("agent=build");
    expect(latestLocation).toContain("session=session-build-older");

    await act(async () => {
      renderer.unmount();
    });
  });

  test("build action for a QA-rejected task navigates to the QA follow-up builder scenario", async () => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "in_progress" });
    currentTaskFixture.documentSummary.qaReport = {
      has: true,
      updatedAt: "2026-03-09T10:00:00.000Z",
      verdict: "rejected",
    };
    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onBuild as (taskId: string) => void)("TASK-123");
    });

    expect(latestSessionStartModalModel).toBeNull();
    expect(startAgentSessionMock).not.toHaveBeenCalled();
    expect(latestLocation).toContain("/agents?task=TASK-123");
    expect(latestLocation).toContain("agent=build");
    expect(latestLocation).toContain("session=session-build-older");

    await act(async () => {
      renderer.unmount();
    });
  });

  test("build action for a human-review task navigates to the human-feedback builder scenario", async () => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "human_review" });
    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onBuild as (taskId: string) => void)("TASK-123");
    });

    expect(latestSessionStartModalModel).toBeNull();
    expect(startAgentSessionMock).not.toHaveBeenCalled();
    expect(latestLocation).toContain("/agents?task=TASK-123");
    expect(latestLocation).toContain("agent=build");
    expect(latestLocation).toContain("session=session-build-older");

    await act(async () => {
      renderer.unmount();
    });
  });

  test("open qa navigates directly to the QA review scenario", async () => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "in_progress" });
    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onQaOpen as (taskId: string) => void)("TASK-123");
    });

    expect(latestSessionStartModalModel).toBeNull();
    expect(latestLocation).toContain("/agents?task=TASK-123");
    expect(latestLocation).toContain("agent=qa");
    expect(latestLocation).toContain("scenario=qa_review");

    await act(async () => {
      renderer.unmount();
    });
  });

  test("shows the shared merged pull request dialog from task state", async () => {
    currentPendingMergedPullRequest = {
      taskId: "TASK-123",
      pullRequest: {
        providerId: "github",
        number: 268,
        url: "https://github.com/Maxsky5/openducktor/pull/268",
        state: "merged",
        createdAt: "2026-03-20T11:00:00Z",
        updatedAt: "2026-03-20T11:21:32Z",
        lastSyncedAt: "2026-03-20T11:21:32Z",
        mergedAt: "2026-03-20T11:21:32Z",
        closedAt: "2026-03-20T11:21:32Z",
      },
    };

    const renderer = await renderPage();

    try {
      expect(latestMergedPullRequestModalProps?.pullRequest).toEqual(
        currentPendingMergedPullRequest.pullRequest,
      );
      expect(latestMergedPullRequestModalProps?.isLinking).toBe(false);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  test("marks the shared merged pull request dialog pending while linking", async () => {
    currentPendingMergedPullRequest = {
      taskId: "TASK-123",
      pullRequest: {
        providerId: "github",
        number: 268,
        url: "https://github.com/Maxsky5/openducktor/pull/268",
        state: "merged",
        createdAt: "2026-03-20T11:00:00Z",
        updatedAt: "2026-03-20T11:21:32Z",
        lastSyncedAt: "2026-03-20T11:21:32Z",
        mergedAt: "2026-03-20T11:21:32Z",
        closedAt: "2026-03-20T11:21:32Z",
      },
    };
    currentLinkingMergedPullRequestTaskId = "TASK-123";

    const renderer = await renderPage();

    try {
      expect(latestMergedPullRequestModalProps?.isLinking).toBe(true);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  test("build action routes human review tasks into the human-changes builder scenario", async () => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "human_review" });
    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onBuild as (taskId: string) => void)("TASK-123");
    });

    expect(latestSessionStartModalModel).toBeNull();
    expect(startAgentSessionMock).not.toHaveBeenCalled();
    expect(latestLocation).toContain("/agents?task=TASK-123");
    expect(latestLocation).toContain("agent=build");
    expect(latestLocation).toContain("session=session-build-older");

    await act(async () => {
      renderer.unmount();
    });
  });
});
