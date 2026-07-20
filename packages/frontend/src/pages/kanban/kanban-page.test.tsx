import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type AppPlatform,
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RepoConfig,
  type RepoPromptOverrides,
  type SettingsSnapshot,
  type TaskApprovalContext,
  type TaskCard,
  type WorkspaceRecord,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { QueryClientProvider } from "@tanstack/react-query";
import { type RenderResult, render, waitFor } from "@testing-library/react";
import { act, isValidElement, type ReactElement } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { hostClient } from "@/lib/host-client";
import { createQueryClient } from "@/lib/query-client";
import { createAgentSessionCollection } from "@/state/agent-session-collection";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import {
  ActiveWorkspaceContext,
  AgentOperationsContext,
  AgentSessionReadModelStateContext,
  AgentSessionsContext,
  ChecksStateContext,
  DelegationStateContext,
  RepoRuntimeHealthContext,
  RuntimeDefinitionsContext,
  SpecStateContext,
  TasksStateContext,
  WorkspaceBranchStateContext,
  WorkspacePresenceContext,
  WorkspaceStateContext,
} from "@/state/app-state-contexts";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { systemQueryKeys } from "@/state/queries/system";
import { workspaceQueryKeys } from "@/state/queries/workspace";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import {
  createRepoRuntimeHealthFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { readyAgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import type {
  AgentOperationsContextValue,
  ChecksStateContextValue,
  DelegationStateContextValue,
  RepoSettingsInput,
  SpecStateContextValue,
  TasksStateContextValue,
  WorkspaceBranchStateContextValue,
  WorkspacePresenceContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";
import {
  createAgentSessionFixture,
  createTaskCardFixture,
  createTaskStoreCheckFixture,
  enableReactActEnvironment,
} from "../agents/agent-studio-test-utils";
import type { KanbanPageModels } from "./kanban-page-model-types";

enableReactActEnvironment();

const originalConsoleError = console.error;

const sessionIdentity = (externalSessionId: string) => ({
  externalSessionId,
  runtimeKind: "opencode" as const,
  workingDirectory: `/repo/worktrees/${externalSessionId}`,
});

const startAgentSessionMock = mock(async () => sessionIdentity("session-1"));
const sendAgentMessageMock = mock(async () => {});
const updateAgentSessionModelMock = mock(() => {});
const humanApproveTaskMock = mock(async () => {});
const humanRequestChangesTaskMock = mock(async () => {});
const deleteTaskMock = mock(async () => {});
const resetTaskImplementationMock = mock(async () => {});
const resetTaskMock = mock(async () => {});
const toastSuccessMock = mock(() => {});
const toastErrorMock = mock(() => {});
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

type PendingMergedPullRequestFixture = {
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
};

type LatestKanbanPageModels = {
  columnProps: Record<string, unknown> | null;
  isLoadingTasks: boolean | null;
  showHorizontalScrollbars: boolean | null;
  humanReviewFeedbackModalModel: Record<string, unknown> | null;
  taskApprovalModalModel: KanbanPageModels["taskApprovalModal"];
  taskGitConflictDialogModel: KanbanPageModels["taskGitConflictDialog"];
  sessionStartModalModel: Record<string, unknown> | null;
  resetImplementationModalModel: Record<string, unknown> | null;
  mergedPullRequestModalProps: Record<string, unknown> | null;
  location: string;
};

type KanbanPageRenderState = {
  tasks: TaskCard[];
  repoConfig: RepoConfig;
  settingsSnapshot: SettingsSnapshot;
  sessions: AgentSessionState[];
  pendingMergedPullRequest: PendingMergedPullRequestFixture | null;
  linkingMergedPullRequestTaskId: string | null;
};

type KanbanPageHarness = RenderResult & {
  getKanbanColumnProps: () => Record<string, unknown>;
  getIsLoadingTasks: () => boolean | null;
  getShowHorizontalScrollbars: () => boolean | null;
  getHumanReviewFeedbackModalModel: () => Record<string, unknown> | null;
  getTaskApprovalModalModel: () => KanbanPageModels["taskApprovalModal"];
  getTaskGitConflictDialogModel: () => KanbanPageModels["taskGitConflictDialog"];
  getSessionStartModalModel: () => Record<string, unknown> | null;
  getResetImplementationModalModel: () => Record<string, unknown> | null;
  getMergedPullRequestModalProps: () => Record<string, unknown> | null;
  getLocation: () => string;
};

let currentPendingMergedPullRequest: PendingMergedPullRequestFixture | null = null;
let currentLinkingMergedPullRequestTaskId: string | null = null;
const RUNTIME_DEFINITIONS = [OPENCODE_RUNTIME_DESCRIPTOR] as const;

let currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "open" });
let currentRepoConfigFixture = createRepoConfigFixture();
let currentSettingsSnapshotFixture = createSettingsSnapshotFixture();
let currentSessionsFixture: AgentSessionState[] = [
  createAgentSessionFixture({
    runtimeKind: "opencode",
    externalSessionId: "session-spec",
    taskId: "TASK-123",
    role: "spec",
    status: "running",
    startedAt: "2026-01-01T00:00:00.000Z",
  }),
  createAgentSessionFixture({
    runtimeKind: "opencode",
    externalSessionId: "session-build-older",
    taskId: "TASK-123",
    role: "build",
    status: "running",
    startedAt: "2026-01-01T12:00:00.000Z",
  }),
  createAgentSessionFixture({
    runtimeKind: "opencode",
    externalSessionId: "session-build-latest",
    taskId: "TASK-123",
    role: "build",
    status: "idle",
    startedAt: "2026-01-02T00:00:00.000Z",
  }),
];

const createRepoSettingsFixture = (): RepoSettingsInput => ({
  defaultRuntimeKind: "opencode" as const,
  worktreeBasePath: "",
  branchPrefix: "codex/",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  preStartHooks: [],
  postCompleteHooks: [],
  devServers: [],
  worktreeCopyPaths: [],
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
});

const activeWorkspaceFixture: WorkspaceRecord = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: "/tmp/default-worktrees",
  effectiveWorktreeBasePath: "/tmp/default-worktrees",
};

const createWorkspaceStateValue = (
  renderState: Pick<KanbanPageRenderState, "settingsSnapshot">,
): WorkspaceStateContextValue => ({
  activeWorkspace: activeWorkspaceFixture,
  workspaces: [activeWorkspaceFixture],
  branches: [],
  activeBranch: null,
  isSwitchingWorkspace: false,
  isLoadingBranches: false,
  isSwitchingBranch: false,
  branchSyncDegraded: false,
  addWorkspace: async () => {},
  selectWorkspace: async () => {},
  reorderWorkspaces: async () => {},
  refreshBranches: async () => {},
  switchBranch: async () => {},
  loadRepoSettings: async () => createRepoSettingsFixture(),
  saveRepoSettings: async () => {},
  loadSettingsSnapshot: async () => renderState.settingsSnapshot,
  detectGithubRepository: async () => null,
  saveGlobalGitConfig: async () => {},
  saveSettingsSnapshot: async () => {},
});

const createWorkspaceBranchStateValue = (): WorkspaceBranchStateContextValue => ({
  activeWorkspace: activeWorkspaceFixture,
  branches: [],
  activeBranch: null,
  isSwitchingWorkspace: false,
  isLoadingBranches: false,
  isSwitchingBranch: false,
  branchSyncDegraded: false,
  switchBranch: async () => {},
});

const createWorkspacePresenceValue = (): WorkspacePresenceContextValue => ({
  hasWorkspaces: true,
});

const createAgentOperationsValue = (): AgentOperationsContextValue => ({
  readSessionTodos: async () => [],
  readSessionHistory: async () => [],
  loadAgentSessionHistory: async () => null,
  loadAgentSessionContext: async () => undefined,
  startAgentSession: startAgentSessionMock,
  sendAgentMessage: sendAgentMessageMock,
  stopAgentSession: async () => {},
  updateAgentSessionModel: updateAgentSessionModelMock,
  replyAgentApproval: async () => {},
  answerAgentQuestion: async () => {},
});

const createTasksStateValue = (
  renderState: Pick<
    KanbanPageRenderState,
    "tasks" | "pendingMergedPullRequest" | "linkingMergedPullRequestTaskId"
  >,
): TasksStateContextValue => ({
  isForegroundLoadingTasks: false,
  isRefreshingTasksInBackground: false,
  tasks: renderState.tasks,
  isLoadingTasks: false,
  createTask: async () => {},
  updateTask: async () => {},
  setTaskTargetBranch: async () => {},
  refreshTasks: async () => {},
  syncPullRequests: async () => {},
  linkMergedPullRequest: async () => {},
  cancelLinkMergedPullRequest: () => {},
  unlinkPullRequest: async () => {},
  detectingPullRequestTaskId: null,
  linkingMergedPullRequestTaskId: renderState.linkingMergedPullRequestTaskId,
  unlinkingPullRequestTaskId: null,
  pendingMergedPullRequest: renderState.pendingMergedPullRequest,
  deleteTask: deleteTaskMock,
  closeTask: async () => {},
  resetTaskImplementation: resetTaskImplementationMock,
  resetTask: resetTaskMock,
  transitionTask: async () => {},
  humanApproveTask: humanApproveTaskMock,
  humanRequestChangesTask: humanRequestChangesTaskMock,
});

const createChecksStateValue = (): ChecksStateContextValue => ({
  runtimeCheck: null,
  taskStoreCheck: createTaskStoreCheckFixture(
    {},
    {
      taskStorePath: "/tmp/task-store/database.sqlite",
      repoStoreHealth: {
        databasePath: "/tmp/task-store/database.sqlite",
      },
    },
  ),
  runtimeCheckFailureKind: null,
  taskStoreCheckFailureKind: null,
  isLoadingChecks: false,
  refreshChecks: async () => {},
});

const delegationStateValue: DelegationStateContextValue = {
  delegateTask: async () => {},
};

const specStateValue: SpecStateContextValue = {
  loadSpec: async () => "",
  loadSpecDocument: async () => ({ markdown: "", updatedAt: null }),
  loadPlanDocument: async () => ({ markdown: "", updatedAt: null }),
  loadQaReportDocument: async () => ({ markdown: "", updatedAt: null }),
  saveSpec: async () => ({ updatedAt: "2026-01-01T00:00:00.000Z" }),
  saveSpecDocument: async () => ({ updatedAt: "2026-01-01T00:00:00.000Z" }),
  savePlanDocument: async () => ({ updatedAt: "2026-01-01T00:00:00.000Z" }),
};

function createRepoConfigFixture(promptOverrides: RepoPromptOverrides = {}): RepoConfig {
  return {
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
    hooks: {
      preStart: [],
      postComplete: [],
    },
    devServers: [],
    worktreeCopyPaths: [],
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
  };
}

const publishKanbanPageModels = (
  latest: LatestKanbanPageModels,
  models: KanbanPageModels,
): void => {
  const firstColumn = models.content.columns[0];
  latest.columnProps = firstColumn
    ? {
        column: firstColumn,
        taskSessionsByTaskId: models.content.taskSessionsByTaskId,
        historicalSessionsByTaskId: models.content.historicalSessionsByTaskId,
        activeTaskSessionContextByTaskId: models.content.activeTaskSessionContextByTaskId,
        taskActivityStateByTaskId: models.content.taskActivityStateByTaskId,
        onOpenDetails: models.content.onOpenDetails,
        onDelegate: models.content.onDelegate,
        onOpenSession: models.content.onOpenSession,
        onPlan: models.content.onPlan,
        onQaStart: models.content.onQaStart,
        onQaOpen: models.content.onQaOpen,
        onBuild: models.content.onBuild,
        onHumanApprove: models.content.onHumanApprove,
        onHumanRequestChanges: models.content.onHumanRequestChanges,
        onResetImplementation: models.content.onResetImplementation,
      }
    : null;
  latest.isLoadingTasks = models.content.isLoadingTasks;
  latest.showHorizontalScrollbars = models.content.showHorizontalScrollbars;
  latest.humanReviewFeedbackModalModel = models.humanReviewFeedbackModal;
  latest.taskApprovalModalModel = models.taskApprovalModal;
  latest.taskGitConflictDialogModel = models.taskGitConflictDialog;
  latest.sessionStartModalModel = models.sessionStartModal;
  latest.resetImplementationModalModel = models.resetImplementationModal;
  latest.mergedPullRequestModalProps = models.mergedPullRequestModal;
};

const getKanbanColumnProps = (latest: LatestKanbanPageModels): Record<string, unknown> => {
  if (!latest.columnProps) {
    throw new Error("Expected the Kanban page model to publish column actions.");
  }
  return latest.columnProps;
};

const renderPage = async (
  options: {
    seedSettingsSnapshot?: boolean;
    seedAgentSessionLists?: boolean;
    platform?: AppPlatform | null;
    tasks?: TaskCard[];
  } = {},
): Promise<KanbanPageHarness> => {
  const renderState: KanbanPageRenderState = {
    tasks: options.tasks ?? [currentTaskFixture],
    repoConfig: currentRepoConfigFixture,
    settingsSnapshot: currentSettingsSnapshotFixture,
    sessions: currentSessionsFixture,
    pendingMergedPullRequest: currentPendingMergedPullRequest,
    linkingMergedPullRequestTaskId: currentLinkingMergedPullRequestTaskId,
  };
  const latest: LatestKanbanPageModels = {
    columnProps: null,
    isLoadingTasks: null,
    showHorizontalScrollbars: null,
    humanReviewFeedbackModalModel: null,
    taskApprovalModalModel: null,
    taskGitConflictDialogModel: null,
    sessionStartModalModel: null,
    resetImplementationModalModel: null,
    mergedPullRequestModalProps: null,
    location: "/",
  };
  const { useKanbanPageModels } = await import("./use-kanban-page-models");
  const sessionStore = createAgentSessionsStore("/repo");
  sessionStore.setSessionCollection(() => createAgentSessionCollection(renderState.sessions));
  const queryClient = createQueryClient();
  const checksStateValue = createChecksStateValue();
  queryClient.setQueryData(workspaceQueryKeys.repoConfig("repo"), renderState.repoConfig);
  if (options.seedSettingsSnapshot !== false) {
    queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), renderState.settingsSnapshot);
  }
  if (options.platform !== null) {
    queryClient.setQueryData(systemQueryKeys.platform(), options.platform ?? "darwin");
  }
  if (options.seedAgentSessionLists !== false) {
    for (const task of renderState.tasks) {
      queryClient.setQueryData(agentSessionQueryKeys.list("/repo", task.id), []);
    }
    queryClient.setQueryData(
      agentSessionQueryKeys.hydration(
        "/repo",
        renderState.tasks.map((task) => task.id),
      ),
      true,
    );
  }
  const LocationProbe = (): ReactElement | null => {
    const location = useLocation();
    latest.location = `${location.pathname}${location.search}`;
    return null;
  };
  const KanbanModelsProbe = (): null => {
    publishKanbanPageModels(
      latest,
      useKanbanPageModels({
        onOpenDetails: () => {},
        onCloseDetails: () => {},
      }),
    );
    return null;
  };

  const renderer = render(
    <QueryClientProvider client={queryClient}>
      <ActiveWorkspaceContext.Provider
        value={{
          activeWorkspace: activeWorkspaceFixture,
          setActiveWorkspace: () => {},
        }}
      >
        <WorkspaceStateContext.Provider value={createWorkspaceStateValue(renderState)}>
          <WorkspaceBranchStateContext.Provider value={createWorkspaceBranchStateValue()}>
            <WorkspacePresenceContext.Provider value={createWorkspacePresenceValue()}>
              <RepoRuntimeHealthContext.Provider
                value={{
                  runtimeHealthByRuntime: {
                    opencode: createRepoRuntimeHealthFixture({ status: "ready" }),
                  },
                  isLoadingRepoRuntimeHealth: false,
                  refreshRepoRuntimeHealth: async () => ({
                    opencode: createRepoRuntimeHealthFixture({ status: "ready" }),
                  }),
                }}
              >
                <ChecksStateContext.Provider value={checksStateValue}>
                  <TasksStateContext.Provider value={createTasksStateValue(renderState)}>
                    <DelegationStateContext.Provider value={delegationStateValue}>
                      <SpecStateContext.Provider value={specStateValue}>
                        <AgentSessionsContext.Provider value={sessionStore}>
                          <AgentOperationsContext.Provider value={createAgentOperationsValue()}>
                            <AgentSessionReadModelStateContext.Provider
                              value={{
                                sessionReadModelLoadState:
                                  readyAgentSessionReadModelLoadState("/repo"),
                                reloadSessionReadModel: () => undefined,
                              }}
                            >
                              <RuntimeDefinitionsContext.Provider
                                value={{
                                  runtimeDefinitions: [...RUNTIME_DEFINITIONS],
                                  availableRuntimeDefinitions: [...RUNTIME_DEFINITIONS],
                                  agentRuntimes: DEFAULT_AGENT_RUNTIMES,
                                  isLoadingRuntimeDefinitions: false,
                                  runtimeDefinitionsError: null,
                                  refreshRuntimeDefinitions: async () => [...RUNTIME_DEFINITIONS],
                                  loadRepoRuntimeCatalog: loadRepoRuntimeCatalogMock,
                                  loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
                                  loadRepoRuntimeSkills: async () => ({ skills: [] }),
                                  loadRepoRuntimeSubagents: async () => ({ subagents: [] }),
                                  loadRepoRuntimeFileSearch: async () => [],
                                }}
                              >
                                <MemoryRouter initialEntries={["/"]}>
                                  <LocationProbe />
                                  <KanbanModelsProbe />
                                </MemoryRouter>
                              </RuntimeDefinitionsContext.Provider>
                            </AgentSessionReadModelStateContext.Provider>
                          </AgentOperationsContext.Provider>
                        </AgentSessionsContext.Provider>
                      </SpecStateContext.Provider>
                    </DelegationStateContext.Provider>
                  </TasksStateContext.Provider>
                </ChecksStateContext.Provider>
              </RepoRuntimeHealthContext.Provider>
            </WorkspacePresenceContext.Provider>
          </WorkspaceBranchStateContext.Provider>
        </WorkspaceStateContext.Provider>
      </ActiveWorkspaceContext.Provider>
    </QueryClientProvider>,
  );

  return Object.assign(renderer, {
    getKanbanColumnProps: () => getKanbanColumnProps(latest),
    getIsLoadingTasks: () => latest.isLoadingTasks,
    getShowHorizontalScrollbars: () => latest.showHorizontalScrollbars,
    getHumanReviewFeedbackModalModel: () => latest.humanReviewFeedbackModalModel,
    getTaskApprovalModalModel: () => latest.taskApprovalModalModel,
    getTaskGitConflictDialogModel: () => latest.taskGitConflictDialogModel,
    getSessionStartModalModel: () => latest.sessionStartModalModel,
    getResetImplementationModalModel: () => latest.resetImplementationModalModel,
    getMergedPullRequestModalProps: () => latest.mergedPullRequestModalProps,
    getLocation: () => latest.location,
  });
};

const waitForMockCall = async (
  fn: { mock: { calls: unknown[][] } },
  minCalls = 1,
): Promise<void> => {
  await waitFor(() => {
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(minCalls);
  });
};

const waitForSessionStartModalReady = async (page: KanbanPageHarness): Promise<void> => {
  await waitFor(() => {
    expect(page.getSessionStartModalModel()).toBeTruthy();
    expect(page.getSessionStartModalModel()?.isSelectionCatalogLoading).not.toBe(true);
  });
};

const confirmSessionStartModal = async (
  page: KanbanPageHarness,
  input?: {
    runInBackground?: boolean;
    startMode?: "fresh" | "reuse" | "fork";
    sourceExternalSessionId?: string | null;
    modelId?: string;
    profileId?: string;
    variant?: string;
  },
): Promise<void> => {
  await waitForSessionStartModalReady(page);

  const expectedStoredModelId = input?.modelId?.includes("/")
    ? input.modelId.split("/").at(-1)
    : input?.modelId;
  const profileId = input?.profileId;
  const modelId = input?.modelId;
  const variant = input?.variant;

  if (profileId) {
    await act(async () => {
      (page.getSessionStartModalModel()?.onSelectAgent as ((value: string) => void) | undefined)?.(
        profileId,
      );
      await Promise.resolve();
    });
  }

  if (modelId) {
    await waitFor(() => {
      expect(page.getSessionStartModalModel()?.isSelectionCatalogLoading).not.toBe(true);
      const modelOptions = page.getSessionStartModalModel()?.modelOptions as
        | Array<{ value?: string }>
        | undefined;
      expect(modelOptions?.some((option) => option.value === modelId)).toBe(true);
    });
    await act(async () => {
      (page.getSessionStartModalModel()?.onSelectModel as ((value: string) => void) | undefined)?.(
        modelId,
      );
      await Promise.resolve();
    });
    await waitFor(() => {
      const selection = page.getSessionStartModalModel()?.selectedModelSelection as
        | { modelId?: string; profileId?: string }
        | null
        | undefined;
      expect(selection?.modelId).toBe(expectedStoredModelId);
      if (profileId) {
        expect(selection?.profileId).toBe(profileId);
      }
    });
  } else if (profileId) {
    await waitFor(() => {
      const selection = page.getSessionStartModalModel()?.selectedModelSelection as
        | { profileId?: string }
        | null
        | undefined;
      expect(selection?.profileId).toBe(profileId);
    });
  }

  if (variant) {
    await act(async () => {
      (
        page.getSessionStartModalModel()?.onSelectVariant as ((value: string) => void) | undefined
      )?.(variant);
      await Promise.resolve();
    });
    await waitFor(() => {
      const selection = page.getSessionStartModalModel()?.selectedModelSelection as
        | { variant?: string }
        | null
        | undefined;
      expect(selection?.variant).toBe(variant);
    });
  }

  await act(async () => {
    const existingSessionOptions =
      (page.getSessionStartModalModel()?.existingSessionOptions as
        | Array<{ value: string; sourceSession: { externalSessionId: string } }>
        | undefined) ?? [];
    const sourceSessionOptionValue = input?.sourceExternalSessionId
      ? (existingSessionOptions.find(
          (option) => option.sourceSession.externalSessionId === input.sourceExternalSessionId,
        )?.value ?? null)
      : null;
    await (
      page.getSessionStartModalModel()?.onConfirm as
        | ((value: {
            runInBackground?: boolean;
            startMode?: "fresh" | "reuse" | "fork";
            sourceSessionOptionValue?: string | null;
          }) => Promise<void> | void)
        | undefined
    )?.({
      runInBackground: input?.runInBackground ?? false,
      startMode: input?.startMode ?? "fresh",
      sourceSessionOptionValue,
    });
    await Promise.resolve();
    await Promise.resolve();
  });
};

const KANBAN_PAGE_TEST_TIMEOUT_MS = 5_000;
const kanbanTest = (name: string, fn: () => Promise<void> | void): void => {
  test(name, fn, KANBAN_PAGE_TEST_TIMEOUT_MS);
};

describe("KanbanPage session start modal flow", () => {
  beforeEach(() => {
    mock.module("sonner", () => ({
      toast: {
        success: toastSuccessMock,
        error: toastErrorMock,
      },
    }));
  });

  beforeEach(async () => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "open" });
    currentRepoConfigFixture = createRepoConfigFixture();
    currentSettingsSnapshotFixture = createSettingsSnapshotFixture();
    currentSessionsFixture = [
      createAgentSessionFixture({
        runtimeKind: "opencode",
        externalSessionId: "session-spec",
        taskId: "TASK-123",
        role: "spec",
        status: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
      createAgentSessionFixture({
        runtimeKind: "opencode",
        externalSessionId: "session-build-older",
        taskId: "TASK-123",
        role: "build",
        status: "running",
        startedAt: "2026-01-01T12:00:00.000Z",
      }),
      createAgentSessionFixture({
        runtimeKind: "opencode",
        externalSessionId: "session-build-latest",
        taskId: "TASK-123",
        role: "build",
        status: "idle",
        startedAt: "2026-01-02T00:00:00.000Z",
      }),
    ];
    currentPendingMergedPullRequest = null;
    currentLinkingMergedPullRequestTaskId = null;
    startAgentSessionMock.mockClear();
    sendAgentMessageMock.mockClear();
    updateAgentSessionModelMock.mockClear();
    humanApproveTaskMock.mockClear();
    humanRequestChangesTaskMock.mockClear();
    deleteTaskMock.mockClear();
    resetTaskImplementationMock.mockClear();
    resetTaskMock.mockClear();
    toastSuccessMock.mockClear();
    toastErrorMock.mockClear();
    loadRepoRuntimeCatalogMock.mockClear();
  });

  afterEach(async () => {
    await restoreMockedModules([["sonner", () => import("sonner")]]);
  });

  afterAll(async () => {
    console.error = originalConsoleError;
  });

  kanbanTest(
    "delegate action opens modal and foreground confirm navigates to Agent Studio",
    async () => {
      const renderer = await renderPage();

      expect(renderer.getKanbanColumnProps()).toBeTruthy();

      await act(async () => {
        (renderer.getKanbanColumnProps().onDelegate as (taskId: string) => void)("TASK-123");
      });

      expect(renderer.getSessionStartModalModel()?.open).toBe(true);

      await confirmSessionStartModal(renderer, {
        modelId: "openai/gpt-5",
        profileId: "build-agent",
        variant: "default",
      });

      await waitForMockCall(startAgentSessionMock);

      expect(startAgentSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "TASK-123",
          role: "build",
          startMode: "fresh",
        }),
      );
      expect(updateAgentSessionModelMock).not.toHaveBeenCalled();
      expect(renderer.getLocation()).toContain("/agents?task=TASK-123");

      await act(async () => {
        renderer.unmount();
      });
    },
  );

  kanbanTest(
    "settings load failure reports an error without issuing a task-list request",
    async () => {
      const originalLoadSettingsSnapshot = hostClient.workspaceGetSettingsSnapshot;
      hostClient.workspaceGetSettingsSnapshot = async () => {
        throw new Error("settings unavailable");
      };

      const renderer = await renderPage({ seedSettingsSnapshot: false });

      try {
        await waitForMockCall(toastErrorMock);

        expect(toastErrorMock).toHaveBeenCalledWith("Failed to load Kanban settings", {
          description: "settings unavailable",
        });
      } finally {
        hostClient.workspaceGetSettingsSnapshot = originalLoadSettingsSnapshot;
        await act(async () => {
          renderer.unmount();
        });
      }
    },
  );

  kanbanTest("uses platform defaults for System horizontal scrollbar visibility", async () => {
    currentSettingsSnapshotFixture = createSettingsSnapshotFixture({
      appearance: { horizontalScrollbarVisibility: "system" },
    });

    const linuxRenderer = await renderPage({ platform: "linux" });
    expect(linuxRenderer.getKanbanColumnProps()).toBeTruthy();
    expect(linuxRenderer.getShowHorizontalScrollbars()).toBe(true);
    await act(async () => {
      linuxRenderer.unmount();
    });

    currentSettingsSnapshotFixture = createSettingsSnapshotFixture({
      appearance: { horizontalScrollbarVisibility: "system" },
    });
    const macRenderer = await renderPage({ platform: "darwin" });
    expect(macRenderer.getKanbanColumnProps()).toBeTruthy();
    expect(macRenderer.getShowHorizontalScrollbars()).toBe(false);
    await act(async () => {
      macRenderer.unmount();
    });
  });

  kanbanTest("does not request platform for explicit horizontal scrollbar modes", async () => {
    const originalSystemGetPlatform = hostClient.systemGetPlatform;
    const systemGetPlatform = mock(async () => {
      throw new Error("platform should not be requested for explicit Appearance modes");
    });
    hostClient.systemGetPlatform = systemGetPlatform;
    currentSettingsSnapshotFixture = createSettingsSnapshotFixture({
      appearance: { horizontalScrollbarVisibility: "show" },
    });

    const renderer = await renderPage();

    try {
      expect(renderer.getKanbanColumnProps()).toBeTruthy();
      expect(systemGetPlatform).toHaveBeenCalledTimes(0);
    } finally {
      hostClient.systemGetPlatform = originalSystemGetPlatform;
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  kanbanTest("reports System platform resolution failures once", async () => {
    const originalSystemGetPlatform = hostClient.systemGetPlatform;
    hostClient.systemGetPlatform = async () => {
      throw new Error("unsupported platform");
    };
    currentSettingsSnapshotFixture = createSettingsSnapshotFixture({
      appearance: { horizontalScrollbarVisibility: "system" },
    });

    const renderer = await renderPage({ platform: null });

    try {
      await waitForMockCall(toastErrorMock);
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Failed to resolve horizontal scrollbar default",
        {
          description: "unsupported platform",
        },
      );
      expect(renderer.getIsLoadingTasks()).toBe(false);
      expect(renderer.getShowHorizontalScrollbars()).toBeNull();
    } finally {
      hostClient.systemGetPlatform = originalSystemGetPlatform;
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  kanbanTest(
    "background confirm keeps user on Kanban and shows background success toast",
    async () => {
      const renderer = await renderPage();

      await act(async () => {
        (renderer.getKanbanColumnProps().onDelegate as (taskId: string) => void)("TASK-123");
      });

      await confirmSessionStartModal(renderer, {
        runInBackground: true,
        modelId: "openai/gpt-5",
        profileId: "build-agent",
        variant: "default",
      });
      await waitForMockCall(sendAgentMessageMock);

      expect(startAgentSessionMock).toHaveBeenCalledTimes(1);
      expect(updateAgentSessionModelMock).not.toHaveBeenCalled();
      expect(sendAgentMessageMock).toHaveBeenCalledTimes(1);
      expect(renderer.getLocation()).toBe("/");
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
      expect(renderer.getLocation()).toContain("/agents?task=TASK-123");
      expect(renderer.getLocation()).toContain("session=session-1");
      expect(renderer.getLocation()).toContain("agent=build");

      toastDescriptionRender.unmount();

      await act(async () => {
        renderer.unmount();
      });
    },
  );

  kanbanTest("reuse confirm fails fast when the modal has no reusable source option", async () => {
    const renderer = await renderPage();

    await act(async () => {
      (renderer.getKanbanColumnProps().onDelegate as (taskId: string) => void)("TASK-123");
    });

    const sessionStartModal = renderer.getSessionStartModalModel();
    if (!sessionStartModal) {
      throw new Error("Expected session start modal.");
    }

    await act(async () => {
      (
        sessionStartModal.onConfirm as (input: {
          runInBackground?: boolean;
          startMode?: "fresh" | "reuse" | "fork";
          sourceSessionOptionValue?: string | null;
        }) => void
      )({
        startMode: "reuse",
        sourceSessionOptionValue:
          (sessionStartModal.selectedSourceSessionValue as string | undefined) ?? null,
      });
      await Promise.resolve();
    });

    expect(startAgentSessionMock).not.toHaveBeenCalled();
    expect(updateAgentSessionModelMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("Failed to start the session.", {
      description:
        "Starting a build build_implementation_start session for TASK-123 requires a source session.",
    });

    await act(async () => {
      renderer.unmount();
    });
  });

  kanbanTest(
    "completed background kickoff does not keep modal in loading state on next open",
    async () => {
      const renderer = await renderPage();

      await act(async () => {
        (renderer.getKanbanColumnProps().onDelegate as (taskId: string) => void)("TASK-123");
      });

      await confirmSessionStartModal(renderer, {
        runInBackground: true,
        modelId: "openai/gpt-5",
        profileId: "build-agent",
        variant: "default",
      });

      await act(async () => {
        (renderer.getKanbanColumnProps().onDelegate as (taskId: string) => void)("TASK-123");
      });

      expect(renderer.getSessionStartModalModel()?.isStarting).toBe(false);

      await act(async () => {
        renderer.unmount();
      });
    },
  );

  kanbanTest("kickoff send failure still reports kickoff error after session start", async () => {
    sendAgentMessageMock.mockImplementationOnce(async () => {
      throw new Error("config unavailable");
    });

    const renderer = await renderPage();

    await act(async () => {
      (renderer.getKanbanColumnProps().onDelegate as (taskId: string) => void)("TASK-123");
    });

    await confirmSessionStartModal(renderer, {
      modelId: "openai/gpt-5",
      profileId: "build-agent",
      variant: "default",
    });

    expect(startAgentSessionMock).toHaveBeenCalledTimes(1);
    expect(sendAgentMessageMock).toHaveBeenCalledTimes(1);
    expect(renderer.getLocation()).toContain("/agents?task=TASK-123");
    await waitForMockCall(toastErrorMock);
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Session started, but the kickoff prompt failed to send.",
      {
        description: "config unavailable",
      },
    );
    expect(toastErrorMock).not.toHaveBeenCalledWith("Failed to start the session.");

    await act(async () => {
      renderer.unmount();
    });
  });

  kanbanTest("session start failure shows a single modal-level error toast", async () => {
    startAgentSessionMock.mockImplementationOnce(async () => {
      throw new Error("Worktree path already exists for task TASK-123");
    });

    const renderer = await renderPage();

    await act(async () => {
      (renderer.getKanbanColumnProps().onDelegate as (taskId: string) => void)("TASK-123");
    });

    await confirmSessionStartModal(renderer, {
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
    expect(renderer.getLocation()).toBe("/");

    await act(async () => {
      renderer.unmount();
    });
  });

  kanbanTest("malformed kickoff override prevents starting a session", async () => {
    currentRepoConfigFixture = createRepoConfigFixture({
      "kickoff.build_implementation_start": {
        template: "Kickoff {{unsupported.token}}",
        baseVersion: 1,
      },
    });

    const renderer = await renderPage();

    await act(async () => {
      (renderer.getKanbanColumnProps().onDelegate as (taskId: string) => void)("TASK-123");
    });

    await confirmSessionStartModal(renderer, {
      modelId: "openai/gpt-5",
      profileId: "build-agent",
      variant: "default",
    });

    expect(startAgentSessionMock).not.toHaveBeenCalled();
    expect(sendAgentMessageMock).not.toHaveBeenCalled();
    expect(renderer.getLocation()).toBe("/");
    await waitForMockCall(toastErrorMock);
    expect(toastErrorMock).toHaveBeenCalledWith("Failed to start the session.", {
      description:
        'Prompt template "kickoff.build_implementation_start" uses unsupported placeholder "unsupported.token".',
    });

    await act(async () => {
      renderer.unmount();
    });
  });

  kanbanTest("modal model edits are propagated to session start payload", async () => {
    const renderer = await renderPage();

    await act(async () => {
      (renderer.getKanbanColumnProps().onDelegate as (taskId: string) => void)("TASK-123");
    });

    const sessionStartModal = renderer.getSessionStartModalModel();
    if (!sessionStartModal) {
      throw new Error("Expected session start modal.");
    }

    await act(async () => {
      (sessionStartModal.onSelectModel as (value: string) => void)("openai/gpt-5");
      (sessionStartModal.onSelectAgent as (value: string) => void)("build-agent");
      (sessionStartModal.onSelectVariant as (value: string) => void)("default");
    });

    await confirmSessionStartModal(renderer, {
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

  kanbanTest(
    "continue spec action navigates to latest spec session without opening modal",
    async () => {
      currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "spec_ready" });
      const renderer = await renderPage();

      await act(async () => {
        (renderer.getKanbanColumnProps().onPlan as (taskId: string, action: string) => void)(
          "TASK-123",
          "set_spec",
        );
      });

      expect(renderer.getSessionStartModalModel()).toBeNull();
      expect(startAgentSessionMock).not.toHaveBeenCalled();
      expect(renderer.getLocation()).toContain("/agents?task=TASK-123");
      expect(renderer.getLocation()).toContain("session=session-spec");

      await act(async () => {
        renderer.unmount();
      });
    },
  );

  kanbanTest(
    "keeps human request changes handler stable across modal state re-renders",
    async () => {
      const renderer = await renderPage();

      const initialOnHumanRequestChanges = renderer.getKanbanColumnProps().onHumanRequestChanges;
      expect(initialOnHumanRequestChanges).toBeDefined();

      await act(async () => {
        (renderer.getKanbanColumnProps().onDelegate as (taskId: string) => void)("TASK-123");
      });

      const nextOnHumanRequestChanges = renderer.getKanbanColumnProps().onHumanRequestChanges;
      expect(nextOnHumanRequestChanges).toBe(initialOnHumanRequestChanges);

      await act(async () => {
        renderer.unmount();
      });
    },
  );

  kanbanTest("human request changes opens dedicated feedback modal before mutating", async () => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "human_review" });
    const renderer = await renderPage();

    await act(async () => {
      await (
        renderer.getKanbanColumnProps().onHumanRequestChanges as (taskId: string) => Promise<void>
      )("TASK-123");
    });

    expect(humanRequestChangesTaskMock).not.toHaveBeenCalled();
    expect(renderer.getHumanReviewFeedbackModalModel()?.open).toBe(true);
    expect(renderer.getHumanReviewFeedbackModalModel()?.message).toBe("");
    expect(renderer.getSessionStartModalModel()).toBeNull();

    await act(async () => {
      renderer.unmount();
    });
  });

  kanbanTest(
    "human request changes opens the shared start modal with reuse selected by default",
    async () => {
      currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "human_review" });
      const renderer = await renderPage();

      await act(async () => {
        await (
          renderer.getKanbanColumnProps().onHumanRequestChanges as (taskId: string) => Promise<void>
        )("TASK-123");
      });

      const feedbackModal = renderer.getHumanReviewFeedbackModalModel();
      if (!feedbackModal) {
        throw new Error("Expected human review feedback modal.");
      }

      await act(async () => {
        (feedbackModal.onMessageChange as (message: string) => void)(
          "Apply the requested human review changes.",
        );
      });

      await act(async () => {
        void (
          renderer.getHumanReviewFeedbackModalModel()?.onConfirm as
            | (() => Promise<void>)
            | undefined
        )?.();
        await Promise.resolve();
      });

      await waitForSessionStartModalReady(renderer);

      expect(startAgentSessionMock).not.toHaveBeenCalled();
      expect(humanRequestChangesTaskMock).not.toHaveBeenCalled();
      expect(sendAgentMessageMock).not.toHaveBeenCalled();
      expect(renderer.getSessionStartModalModel()?.open).toBe(true);
      expect(renderer.getSessionStartModalModel()?.selectedStartMode).toBe("reuse");
      const existingSessionOptions = renderer.getSessionStartModalModel()?.existingSessionOptions as
        | Array<{ value: string }>
        | undefined;
      const selectedSourceOption = existingSessionOptions?.[0];
      if (!selectedSourceOption) {
        throw new Error("Expected a reusable builder session option.");
      }
      expect(renderer.getSessionStartModalModel()?.selectedSourceSessionValue).toBe(
        selectedSourceOption.value,
      );
      expect(renderer.getSessionStartModalModel()?.existingSessionOptions).toEqual([
        expect.objectContaining({
          sourceSession: expect.objectContaining({ externalSessionId: "session-build-latest" }),
        }),
        expect.objectContaining({
          sourceSession: expect.objectContaining({ externalSessionId: "session-build-older" }),
        }),
      ]);

      await act(async () => {
        renderer.unmount();
      });
    },
  );

  kanbanTest(
    "human request changes opens the shared start modal in fresh mode when no builder session exists",
    async () => {
      currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "human_review" });
      const [specSession] = currentSessionsFixture;
      expect(specSession).toBeDefined();
      currentSessionsFixture = specSession ? [specSession] : [];
      const renderer = await renderPage();

      await act(async () => {
        await (
          renderer.getKanbanColumnProps().onHumanRequestChanges as (taskId: string) => Promise<void>
        )("TASK-123");
      });

      expect(renderer.getHumanReviewFeedbackModalModel()?.open).toBe(true);

      const feedbackModal = renderer.getHumanReviewFeedbackModalModel();
      if (!feedbackModal) {
        throw new Error("Expected human review feedback modal.");
      }

      await act(async () => {
        (feedbackModal.onMessageChange as (message: string) => void)(
          "Use a fresh builder session for these changes.",
        );
      });

      await act(async () => {
        void (
          renderer.getHumanReviewFeedbackModalModel()?.onConfirm as
            | (() => Promise<void>)
            | undefined
        )?.();
        await Promise.resolve();
      });

      await waitForSessionStartModalReady(renderer);

      expect(renderer.getSessionStartModalModel()?.open).toBe(true);
      expect(renderer.getSessionStartModalModel()?.selectedStartMode).toBe("fresh");
      expect(renderer.getSessionStartModalModel()?.existingSessionOptions).toEqual([]);

      await act(async () => {
        renderer.unmount();
      });
    },
  );

  kanbanTest(
    "canceling request-changes session selection restores the feedback draft",
    async () => {
      currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "human_review" });
      const renderer = await renderPage();

      await act(async () => {
        await (
          renderer.getKanbanColumnProps().onHumanRequestChanges as (taskId: string) => Promise<void>
        )("TASK-123");
      });

      const feedbackModal = renderer.getHumanReviewFeedbackModalModel();
      if (!feedbackModal) {
        throw new Error("Expected human review feedback modal.");
      }

      await act(async () => {
        (feedbackModal.onMessageChange as (message: string) => void)(
          "Keep this request-changes draft.",
        );
      });

      await act(async () => {
        void (
          renderer.getHumanReviewFeedbackModalModel()?.onConfirm as
            | (() => Promise<void>)
            | undefined
        )?.();
        await Promise.resolve();
      });

      await waitForSessionStartModalReady(renderer);

      const sessionStartModal = renderer.getSessionStartModalModel();
      if (!sessionStartModal) {
        throw new Error("Expected session start modal.");
      }
      expect(sessionStartModal.open).toBe(true);

      await act(async () => {
        (sessionStartModal.onOpenChange as (open: boolean) => void)(false);
      });

      await waitFor(() => {
        expect(renderer.getSessionStartModalModel()).toBeNull();
        expect(renderer.getHumanReviewFeedbackModalModel()?.open).toBe(true);
        expect(renderer.getHumanReviewFeedbackModalModel()?.message).toBe(
          "Keep this request-changes draft.",
        );
      });

      await act(async () => {
        renderer.unmount();
      });
    },
  );

  kanbanTest("reset implementation closes after durable reset succeeds", async () => {
    currentTaskFixture = createTaskCardFixture({
      id: "TASK-123",
      status: "in_progress",
      availableActions: ["reset_implementation"],
    });
    currentSessionsFixture = [
      createAgentSessionFixture({
        runtimeKind: "opencode",
        externalSessionId: "session-build-idle",
        taskId: "TASK-123",
        role: "build",
        status: "idle",
        startedAt: "2026-01-02T00:00:00.000Z",
      }),
      createAgentSessionFixture({
        runtimeKind: "opencode",
        externalSessionId: "session-qa-stopped",
        taskId: "TASK-123",
        role: "qa",
        status: "stopped",
        startedAt: "2026-01-03T00:00:00.000Z",
      }),
    ];
    const renderer = await renderPage();

    await act(async () => {
      (renderer.getKanbanColumnProps().onResetImplementation as (taskId: string) => void)(
        "TASK-123",
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderer.getResetImplementationModalModel()?.open).toBe(true);

    const resetModal = renderer.getResetImplementationModalModel();
    if (!resetModal) {
      throw new Error("Expected reset implementation modal.");
    }

    await act(async () => {
      (resetModal.onConfirm as () => void)();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(resetTaskImplementationMock).toHaveBeenCalledWith("TASK-123");
    await waitFor(() => {
      expect(renderer.getResetImplementationModalModel()).toBeNull();
    });

    await act(async () => {
      renderer.unmount();
    });
  });

  kanbanTest(
    "reset implementation is blocked while a task role is active in a worktree",
    async () => {
      currentTaskFixture = createTaskCardFixture({
        id: "TASK-123",
        status: "in_progress",
        availableActions: ["reset_implementation"],
      });
      currentSessionsFixture = [
        createAgentSessionFixture({
          runtimeKind: "opencode",
          externalSessionId: "session-build-waiting",
          taskId: "TASK-123",
          role: "spec",
          workingDirectory: "/tmp/default-worktrees/TASK-123",
          status: "idle",
          startedAt: "2026-01-02T00:00:00.000Z",
          pendingApprovals: [],
          pendingQuestions: [
            {
              requestId: "question-1",
              questions: [
                {
                  header: "Decision",
                  question: "Can reset continue?",
                  options: [{ label: "No", description: "Keep waiting" }],
                },
              ],
            },
          ],
        }),
      ];
      const renderer = await renderPage();

      await act(async () => {
        (renderer.getKanbanColumnProps().onResetImplementation as (taskId: string) => void)(
          "TASK-123",
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(renderer.getResetImplementationModalModel()).toBeNull();
      expect(toastErrorMock).toHaveBeenCalledWith("Stop active work first", {
        description:
          "A task session is still active for TASK-123. Stop the active session before resetting the implementation.",
      });
      expect(resetTaskImplementationMock).not.toHaveBeenCalled();

      await act(async () => {
        renderer.unmount();
      });
    },
  );

  kanbanTest(
    "reset implementation allows a legacy root-backed Spec session to remain active",
    async () => {
      currentTaskFixture = createTaskCardFixture({
        id: "TASK-123",
        status: "in_progress",
        availableActions: ["reset_implementation"],
      });
      currentSessionsFixture = [
        createAgentSessionFixture({
          runtimeKind: "opencode",
          externalSessionId: "legacy-root-spec",
          taskId: "TASK-123",
          role: "spec",
          workingDirectory: "/repo/",
          status: "idle",
          pendingQuestions: [
            {
              requestId: "question-1",
              questions: [
                {
                  header: "Decision",
                  question: "Can reset continue?",
                  options: [{ label: "No", description: "Keep waiting" }],
                },
              ],
            },
          ],
        }),
      ];
      const renderer = await renderPage();

      await act(async () => {
        (renderer.getKanbanColumnProps().onResetImplementation as (taskId: string) => void)(
          "TASK-123",
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(renderer.getResetImplementationModalModel()).not.toBeNull();
      expect(toastErrorMock).not.toHaveBeenCalledWith("Stop active work first", expect.anything());

      await act(async () => {
        renderer.unmount();
      });
    },
  );

  kanbanTest("reset implementation keeps the modal open when reset fails", async () => {
    currentTaskFixture = createTaskCardFixture({
      id: "TASK-123",
      status: "in_progress",
      availableActions: ["reset_implementation"],
    });
    currentSessionsFixture = [
      createAgentSessionFixture({
        runtimeKind: "opencode",
        externalSessionId: "session-build-idle",
        taskId: "TASK-123",
        role: "build",
        status: "idle",
        startedAt: "2026-01-02T00:00:00.000Z",
      }),
    ];
    const renderer = await renderPage();

    await act(async () => {
      (renderer.getKanbanColumnProps().onResetImplementation as (taskId: string) => void)(
        "TASK-123",
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    resetTaskImplementationMock.mockImplementationOnce(async () => {
      throw new Error("reset failed");
    });

    const resetModal = renderer.getResetImplementationModalModel();
    if (!resetModal) {
      throw new Error("Expected reset implementation modal.");
    }

    await act(async () => {
      (resetModal.onConfirm as () => void)();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(renderer.getResetImplementationModalModel()?.errorMessage).toBe("reset failed");
      expect(renderer.getResetImplementationModalModel()?.open).toBe(true);
    });

    await act(async () => {
      renderer.unmount();
    });
  });

  kanbanTest(
    "reset implementation reports a missing task instead of silently returning",
    async () => {
      const renderer = await renderPage();

      await act(async () => {
        (renderer.getKanbanColumnProps().onResetImplementation as (taskId: string) => void)(
          "MISSING-1",
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(toastErrorMock).toHaveBeenCalledWith("Unable to reset implementation", {
        description: "Task MISSING-1 was not found. Refresh tasks and try again.",
      });
      expect(renderer.getResetImplementationModalModel()).toBeNull();

      await act(async () => {
        renderer.unmount();
      });
    },
  );

  kanbanTest("build action bypasses modal and navigates directly", async () => {
    const renderer = await renderPage();

    await act(async () => {
      (renderer.getKanbanColumnProps().onBuild as (taskId: string) => void)("TASK-123");
    });

    expect(renderer.getSessionStartModalModel()).toBeNull();
    expect(startAgentSessionMock).not.toHaveBeenCalled();
    expect(renderer.getLocation()).toContain("/agents?task=TASK-123");
    expect(renderer.getLocation()).toContain("agent=build");
    expect(renderer.getLocation()).toContain("session=session-build-older");

    await act(async () => {
      renderer.unmount();
    });
  });

  kanbanTest(
    "git conflict resolution opens the exact external-session Agent Studio route",
    async () => {
      currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "human_review" });
      const originalTaskApprovalContextGet = hostClient.taskApprovalContextGet;
      const originalTaskDirectMerge = hostClient.taskDirectMerge;
      const originalWorkspaceGetRepoConfig = hostClient.workspaceGetRepoConfig;
      const originalWorkspaceGetSettingsSnapshot = hostClient.workspaceGetSettingsSnapshot;
      const approvalContext: TaskApprovalContext = {
        taskId: "TASK-123",
        taskStatus: "human_review",
        workingDirectory: "/repo/worktrees/conflict",
        sourceBranch: "odt/TASK-123",
        targetBranch: { remote: "origin", branch: "main" },
        publishTarget: { remote: "origin", branch: "main" },
        defaultMergeMethod: "merge_commit",
        hasUncommittedChanges: false,
        uncommittedFileCount: 0,
        providers: [],
      };
      hostClient.taskApprovalContextGet = async () => ({
        outcome: "ready",
        approvalContext,
      });
      hostClient.taskDirectMerge = async () => ({
        outcome: "conflicts",
        conflict: {
          operation: "direct_merge_merge_commit",
          currentBranch: "odt/TASK-123",
          targetBranch: "main",
          conflictedFiles: ["src/app.ts"],
          output: "conflict output",
          workingDir: "/repo/worktrees/conflict",
        },
      });
      hostClient.workspaceGetRepoConfig = async () => currentRepoConfigFixture;
      hostClient.workspaceGetSettingsSnapshot = async () => currentSettingsSnapshotFixture;

      const renderer = await renderPage();

      try {
        await act(async () => {
          (renderer.getKanbanColumnProps().onHumanApprove as (taskId: string) => void)("TASK-123");
          await Promise.resolve();
        });
        await waitFor(() => {
          expect(renderer.getTaskApprovalModalModel()?.stage).toBe("approval");
        });

        const approvalModal = renderer.getTaskApprovalModalModel();
        if (approvalModal?.stage !== "approval") {
          throw new Error("Expected the task approval modal.");
        }
        await act(async () => {
          approvalModal.onConfirm();
          await Promise.resolve();
        });
        await waitFor(() => {
          expect(renderer.getTaskGitConflictDialogModel()?.open).toBe(true);
        });

        await act(async () => {
          renderer.getTaskGitConflictDialogModel()?.onAskBuilder();
          await Promise.resolve();
        });
        await confirmSessionStartModal(renderer, {
          modelId: "openai/gpt-5",
          profileId: "build-agent",
          startMode: "fresh",
          variant: "default",
        });
        await waitFor(() => {
          expect(renderer.getLocation()).toBe(
            "/agents?task=TASK-123&session=session-1&agent=build",
          );
        });
        const sessionExternalId = new URL(
          renderer.getLocation(),
          "https://openducktor.local",
        ).searchParams.get("session");
        expect(sessionExternalId).toBe("session-1");
        expect(sessionExternalId).not.toContain("opencode");
        expect(sessionExternalId).not.toContain("%2Frepo");
        expect(sessionExternalId).not.toContain("|");
      } finally {
        hostClient.taskApprovalContextGet = originalTaskApprovalContextGet;
        hostClient.taskDirectMerge = originalTaskDirectMerge;
        hostClient.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
        hostClient.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
        await act(async () => {
          renderer.unmount();
        });
      }
    },
  );

  kanbanTest(
    "build action for a QA-rejected task navigates to the QA follow-up builder launch action",
    async () => {
      currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "in_progress" });
      currentTaskFixture.documentSummary.qaReport = {
        has: true,
        updatedAt: "2026-03-09T10:00:00.000Z",
        verdict: "rejected",
      };
      const renderer = await renderPage();

      await act(async () => {
        (renderer.getKanbanColumnProps().onBuild as (taskId: string) => void)("TASK-123");
      });

      expect(renderer.getSessionStartModalModel()).toBeNull();
      expect(startAgentSessionMock).not.toHaveBeenCalled();
      expect(renderer.getLocation()).toContain("/agents?task=TASK-123");
      expect(renderer.getLocation()).toContain("agent=build");
      expect(renderer.getLocation()).toContain("session=session-build-older");

      await act(async () => {
        renderer.unmount();
      });
    },
  );

  kanbanTest(
    "build action for a human-review task navigates to the human-feedback builder launch action",
    async () => {
      currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "human_review" });
      const renderer = await renderPage();

      await act(async () => {
        (renderer.getKanbanColumnProps().onBuild as (taskId: string) => void)("TASK-123");
      });

      expect(renderer.getSessionStartModalModel()).toBeNull();
      expect(startAgentSessionMock).not.toHaveBeenCalled();
      expect(renderer.getLocation()).toContain("/agents?task=TASK-123");
      expect(renderer.getLocation()).toContain("agent=build");
      expect(renderer.getLocation()).toContain("session=session-build-older");

      await act(async () => {
        renderer.unmount();
      });
    },
  );

  kanbanTest("open qa navigates directly to the QA review launch action", async () => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "in_progress" });
    const renderer = await renderPage();

    await act(async () => {
      (renderer.getKanbanColumnProps().onQaOpen as (taskId: string) => void)("TASK-123");
    });

    expect(renderer.getSessionStartModalModel()).toBeNull();
    expect(renderer.getLocation()).toContain("/agents?task=TASK-123");
    expect(renderer.getLocation()).toContain("agent=qa");

    await act(async () => {
      renderer.unmount();
    });
  });

  kanbanTest("shows the shared merged pull request dialog from task state", async () => {
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
      expect(renderer.getMergedPullRequestModalProps()?.pullRequest).toEqual(
        currentPendingMergedPullRequest.pullRequest,
      );
      expect(renderer.getMergedPullRequestModalProps()?.isLinking).toBe(false);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  kanbanTest("marks the shared merged pull request dialog pending while linking", async () => {
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
      expect(renderer.getMergedPullRequestModalProps()?.isLinking).toBe(true);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  kanbanTest(
    "build action routes human review tasks into the human-changes builder launch action",
    async () => {
      currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "human_review" });
      const renderer = await renderPage();

      await act(async () => {
        (renderer.getKanbanColumnProps().onBuild as (taskId: string) => void)("TASK-123");
      });

      expect(renderer.getSessionStartModalModel()).toBeNull();
      expect(startAgentSessionMock).not.toHaveBeenCalled();
      expect(renderer.getLocation()).toContain("/agents?task=TASK-123");
      expect(renderer.getLocation()).toContain("agent=build");
      expect(renderer.getLocation()).toContain("session=session-build-older");

      await act(async () => {
        renderer.unmount();
      });
    },
  );
});
