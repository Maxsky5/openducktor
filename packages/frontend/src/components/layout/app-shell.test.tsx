import { beforeAll, afterAll } from "bun:test";
import {
  installLocalOnlyProviderSetup,
  localOnlyWorkspaceDetails,
} from "@/test-utils/workspace-provider-setup-fixture";
let releaseProviderFixture: (() => void) | undefined;
beforeAll(() => {
  releaseProviderFixture = installLocalOnlyProviderSetup();
});
afterAll(() => releaseProviderFixture?.());
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  type AgentSessionRecord,
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RepoConfig,
  type TaskCard,
  type WorkspaceRecord,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as pierre from "@pierre/diffs";
import * as pierreReact from "@pierre/diffs/react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ReactElement, useEffect, useState } from "react";
import { Link, MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { toast } from "sonner";
import {
  buildMessage,
  buildSession,
} from "@/components/features/agents/agent-chat/agent-chat-test-fixtures";
import { useAgentChatTranscriptModel } from "@/components/features/agents/agent-chat/use-agent-chat-transcript-model";
import * as diffWorkers from "@/contexts/DiffWorkerProvider";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { WorkspacePreviewTransitionGuardProvider } from "@/components/layout/workspace-preview-transition-guard";
import { createQueryClient } from "@/lib/query-client";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import {
  ActiveWorkspaceContext,
  AgentSessionsContext,
  ChecksStateContext,
  HostRuntimeStatusContext,
  RuntimeDefinitionsContext,
  TaskControlContext,
  TasksStateContext,
  WorkspaceBranchStateContext,
  WorkspacePresenceContext,
  WorkspaceStateContext,
  useActiveWorkspaceContext,
} from "@/state/app-state-contexts";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import {
  NotificationContext,
  type NotificationContextValue,
} from "@/state/notifications/notification-context";
import { filesystemQueryKeys } from "@/state/queries/filesystem";
import {
  runtimeDefinitionsQueryOptions,
  runtimeExecutableQueryOptions,
} from "@/state/queries/runtime";
import { platformQueryOptions } from "@/state/queries/system";
import { repoTaskDataQueryOptions } from "@/state/queries/tasks";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { useRecentItemsStore } from "@/features/command-palette/recent-items";
import { repoConfigQueryOptions, settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { DiagnosticsAutoOpenProvider } from "@/state/providers/diagnostics-auto-open-provider";
import { WorkspaceActivityContext } from "@/state/workspace-activity/workspace-activity-context";
import { SettingsModalProvider } from "@/components/features/settings/settings-modal";
import { DiagnosticsPanelProvider } from "@/components/features/diagnostics";
import {
  type TaskWorkflowActions,
  TaskWorkflowActionsContext,
} from "@/features/task-workflow/task-workflow-actions-context";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { replaceNavigatorClipboard } from "@/test-utils/mock-clipboard";
import {
  createChecksStateFixture,
  createDeferred,
  createHostRuntimeStatusContextValue,
  createSettingsSnapshotFixture,
  createTaskCardFixture,
  createTaskStoreCheckFixture,
  createTaskWorkflowActionsFixture,
  createWorkspaceActivityObserverStub,
} from "@/test-utils/shared-test-fixtures";
import type {
  ActiveWorkspace,
  ChecksStateContextValue,
  TasksStateContextValue,
  WorkspaceBranchStateContextValue,
  WorkspacePresenceContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";
import { AppShell } from "./app-shell";

const LEFT_SIDEBAR_STORAGE_KEY = "openducktor:app-shell:left-sidebar";
const SESSION_SCOPE_STORAGE_KEY = "openducktor:sidebar:session-scope";

const activeWorkspace = {
  workspaceId: "workspace-1",
  workspaceName: "OpenDucktor",
  abbreviation: null,
  tileColor: null,
  repoPath: "/repo",
  iconDataUrl: undefined,
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: null,
  effectiveWorktreeBasePath: null,
} satisfies WorkspaceRecord;

const activeRepoConfig = {
  workspaceId: activeWorkspace.workspaceId,
  workspaceName: activeWorkspace.workspaceName,
  repoPath: activeWorkspace.repoPath,
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { postComplete: [] },
  actions: { items: [], defaultActionId: null },
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  agentStudioState: { openTaskIds: [] },
} satisfies RepoConfig;

const taskControlValue = {
  refreshTaskData: async () => {},
  loadWorkspaceTasks: async () => {},
  refreshTasksWithOptions: async () => {},
  clearTaskData: () => {},
  setIsLoadingTasks: () => {},
};

const notificationContextValue = {
  deliveryFailure: null,
  getCapability: async () => ({
    platform: "unavailable" as const,
    supported: false,
    permission: "not_applicable" as const,
    canGuaranteeSilent: false,
    canOpenSystemSettings: false,
  }),
  requestPermission: async () => {
    throw new Error("Unexpected notification permission request.");
  },
  openSystemSettings: async () => {},
  previewCue: async () => {},
  testInApp: async () => {},
  testOs: async () => ({ status: "shown" as const }),
  registerNavigator: () => () => {},
  sessionStartNotifications: {
    publishSessionStarted: () => {},
    publishSessionError: async () => true,
    markInAppFeedbackHandled: () => {},
    reportFailure: () => {},
  },
} satisfies NotificationContextValue;

type MemoryStorageOverrides = {
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
};

class MemoryStorage implements Storage {
  readonly #items = new Map<string, string>();
  readonly #getItemOverride: MemoryStorageOverrides["getItem"];
  readonly #setItemOverride: MemoryStorageOverrides["setItem"];

  constructor(overrides: MemoryStorageOverrides = {}) {
    this.#getItemOverride = overrides.getItem;
    this.#setItemOverride = overrides.setItem;
  }

  get length(): number {
    return this.#items.size;
  }

  clear(): void {
    this.#items.clear();
  }

  getItem(key: string): string | null {
    if (this.#getItemOverride) {
      return this.#getItemOverride(key);
    }

    return this.#items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#items.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.#setItemOverride) {
      this.#setItemOverride(key, value);
      return;
    }

    this.#items.set(key, value);
  }
}

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

const installLocalStorage = (storage: Storage): void => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
};

const createWorkspaceState = (
  overrides: Partial<WorkspaceStateContextValue> = {},
): WorkspaceStateContextValue => ({
  isSwitchingWorkspace: false,
  closedWorkspaces: [],
  incompleteRemovals: [],
  closeWorkspace: async () => {},
  removeWorkspace: async () => {},
  reopenWorkspace: async () => {},
  resolveWorkspacePath: async () => ({ kind: "new" }),
  isLoadingBranches: false,
  isSwitchingBranch: false,
  branchSyncDegraded: false,
  workspaces: [activeWorkspace],
  activeWorkspace,
  branches: [],
  activeBranch: null,
  commitWorkspaceProviderSetup: async () => {
    throw new Error("Not used");
  },
  addWorkspace: async () => {
    throw new Error("Not used");
  },
  saveWorkspaceModelDefaults: async () => {},
  selectWorkspace: async () => undefined,
  reorderWorkspaces: async () => undefined,
  refreshBranches: async () => undefined,
  switchBranch: async () => undefined,
  loadRepoSettings: async () => {
    throw new Error("loadRepoSettings is not used in this test");
  },
  saveRepoSettings: async () => undefined,
  loadSettingsSnapshot: async () => createSettingsSnapshotFixture(),
  detectGithubRepository: async () => null,
  saveGlobalGitConfig: async () => undefined,
  previewSettingsSnapshotRuntime: async () => ({ impact: null }),
  saveSettingsSnapshot: async () => ({
    type: "saved" as const,
    workspaces: [],
    runtimeApplications: [],
    refreshError: null,
  }),
  saveAgentModelFavorites: async () => {
    throw new Error("saveAgentModelFavorites is not used in this test");
  },
  ...overrides,
});

const createWorkspaceBranchState = (
  overrides: Partial<WorkspaceBranchStateContextValue> = {},
): WorkspaceBranchStateContextValue => ({
  activeWorkspace,
  branches: [],
  activeBranch: null,
  isLoadingBranches: false,
  isSwitchingBranch: false,
  branchSyncDegraded: false,
  switchBranch: async () => undefined,
  ...overrides,
});

type RenderAppShellForTestOptions = {
  closedOnly?: boolean;
  closedWorkspaces?: WorkspaceRecord[];
  incompleteRemovals?: WorkspaceStateContextValue["incompleteRemovals"];
  extraWorkspaces?: WorkspaceRecord[];
  initialEntry?: string;
  initiallyUnselectedWorkspace?: boolean;
  isLoadingRuntimeDefinitions?: boolean;
  runtimeDefinitionsError?: string | null;
  workspaceAdd?: (
    input: Parameters<WorkspaceStateContextValue["addWorkspace"]>[0],
  ) => Promise<WorkspaceRecord>;
  workspacePresence?: Partial<WorkspacePresenceContextValue>;
  prepareQueryClient?: (queryClient: QueryClient) => void;
  sessionContent?: ReactElement;
  /** Tasks that the task state shows for the active workspace, by repository path. */
  tasksByRepoPath?: Record<string, TaskCard[]>;
  taskWorkflowActions?: Partial<TaskWorkflowActions>;
};

function CurrentRoute(): ReactElement {
  const location = useLocation();

  return (
    <>
      <div data-testid="current-route">{location.pathname}</div>
      <div data-testid="current-address">{`${location.pathname}${location.search}`}</div>
    </>
  );
}

const createChecksState = (): ChecksStateContextValue => createChecksStateFixture();

const createTasksState = (tasks: TaskCard[] = []): TasksStateContextValue => ({
  tasksAreCurrent: true,
  isForegroundLoadingTasks: false,
  isRefreshingTasksInBackground: false,
  isLoadingTasks: false,
  detectingPullRequestTaskIds: new Set<string>(),
  linkingMergedPullRequestTaskId: null,
  unlinkingPullRequestTaskIds: new Set<string>(),
  pendingMergedPullRequest: null,
  tasks,
  refreshTasks: async () => undefined,
  syncPullRequests: async () => undefined,
  linkMergedPullRequest: async () => undefined,
  cancelLinkMergedPullRequest: () => undefined,
  unlinkPullRequest: async () => undefined,
  createTask: async () => undefined,
  updateTask: async () => undefined,
  setTaskTargetBranch: async () => undefined,
  deleteTask: async () => undefined,
  closeTask: async () => undefined,
  resetTaskImplementation: async () => undefined,
  resetTask: async () => undefined,
  transitionTask: async () => undefined,
  humanApproveTask: async () => undefined,
  humanRequestChangesTask: async () => undefined,
});

function AppShellTestEnvironment({
  options,
  queryClient,
  settingsSnapshot,
}: {
  options: RenderAppShellForTestOptions;
  queryClient: ReturnType<typeof createQueryClient>;
  settingsSnapshot: ReturnType<typeof createSettingsSnapshotFixture>;
}): ReactElement {
  const startsWithWorkspaces =
    !options.closedOnly && (options.workspacePresence?.hasWorkspaces ?? true);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>(
    startsWithWorkspaces ? [activeWorkspace, ...(options.extraWorkspaces ?? [])] : [],
  );
  const [currentWorkspace, setCurrentWorkspace] = useState<WorkspaceRecord | null>(
    startsWithWorkspaces ? activeWorkspace : null,
  );
  const [currentActiveWorkspace, setCurrentActiveWorkspace] = useState<ActiveWorkspace | null>(
    startsWithWorkspaces && !options.initiallyUnselectedWorkspace ? activeWorkspace : null,
  );
  useEffect(() => {
    if (options.initiallyUnselectedWorkspace) setCurrentActiveWorkspace(activeWorkspace);
  }, [options.initiallyUnselectedWorkspace]);
  const publishesWorkspaceAfterAdd = options.workspaceAdd !== undefined;
  const hasWorkspaces =
    options.closedOnly ||
    (publishesWorkspaceAfterAdd ? workspaces.length > 0 : startsWithWorkspaces);
  const addWorkspace: WorkspaceStateContextValue["addWorkspace"] = async (input) => {
    if (!options.workspaceAdd) throw new Error("Not used");
    const workspace = await options.workspaceAdd(input);
    setWorkspaces([workspace]);
    setCurrentWorkspace(workspace);
    setCurrentActiveWorkspace(workspace);
    return workspace;
  };

  return (
    <MemoryRouter initialEntries={[options.initialEntry ?? "/kanban"]} useTransitions={false}>
      <CurrentRoute />
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ActiveWorkspaceContext.Provider
            value={{
              activeWorkspace: currentActiveWorkspace,
              setActiveWorkspace: setCurrentActiveWorkspace,
            }}
          >
            <WorkspacePresenceContext.Provider
              value={{
                hasLoadedWorkspaceList: true,
                workspaceRecordsAreCurrent: true,
                isLoadingWorkspaces: false,
                workspaceLoadError: null,
                retryWorkspaces: async () => {},
                ...options.workspacePresence,
                hasWorkspaces,
              }}
            >
              <WorkspaceStateContext.Provider
                value={createWorkspaceState({
                  workspaces,
                  closedWorkspaces: options.closedOnly
                    ? [{ ...activeWorkspace, isActive: false }]
                    : (options.closedWorkspaces ?? []),
                  incompleteRemovals: options.incompleteRemovals ?? [],
                  activeWorkspace: currentWorkspace,
                  addWorkspace,
                  commitWorkspaceProviderSetup: async (input) => ({
                    workspace: await addWorkspace(localOnlyWorkspaceDetails(input)),
                    registrationSaved: true,
                    settingsSaved: true,
                    credentialsSaved: true,
                    phase: "complete",
                    error: null,
                  }),
                  selectWorkspace: async (workspaceId) => {
                    const selected = workspaces.find(
                      (workspace) => workspace.workspaceId === workspaceId,
                    );
                    if (!selected) throw new Error(`Unknown workspace: ${workspaceId}`);
                    setWorkspaces((current) =>
                      current.map((workspace) => ({
                        ...workspace,
                        isActive: workspace.workspaceId === workspaceId,
                      })),
                    );
                    setCurrentWorkspace({ ...selected, isActive: true });
                    setCurrentActiveWorkspace(selected);
                  },
                })}
              >
                <WorkspaceBranchStateContext.Provider
                  value={createWorkspaceBranchState({ activeWorkspace: currentWorkspace })}
                >
                  <RuntimeDefinitionsContext.Provider
                    value={{
                      runtimeDefinitions: [],
                      availableRuntimeDefinitions: [],
                      agentRuntimes: settingsSnapshot.agentRuntimes,
                      isLoadingRuntimeDefinitions: options.isLoadingRuntimeDefinitions ?? false,
                      runtimeDefinitionsError: options.runtimeDefinitionsError ?? null,
                      isLoadingRuntimeSettings: false,
                      runtimeSettingsError: null,
                      hasRuntimeSettingsSnapshot: true,
                      refreshRuntimeSettings: async () => {},
                      refreshRuntimeDefinitions: async () => [],
                      loadRepoRuntimeCatalog: async () => {
                        throw new Error("loadRepoRuntimeCatalog is not used in this test");
                      },
                      loadRepoRuntimeFileSearch: async () => {
                        throw new Error("loadRepoRuntimeFileSearch is not used in this test");
                      },
                    }}
                  >
                    <HostRuntimeStatusContext.Provider
                      value={createHostRuntimeStatusContextValue({ statusByKind: {} })}
                    >
                      <DiagnosticsAutoOpenProvider>
                        <ChecksStateContext.Provider value={createChecksState()}>
                          <TasksStateContext.Provider
                            value={createTasksState(
                              options.tasksByRepoPath?.[currentWorkspace?.repoPath ?? ""],
                            )}
                          >
                            <TaskControlContext.Provider value={taskControlValue}>
                              <AgentSessionsContext.Provider
                                value={createAgentSessionsStore("/repo")}
                              >
                                <NotificationContext.Provider value={notificationContextValue}>
                                  <WorkspaceActivityContext.Provider
                                    value={createWorkspaceActivityObserverStub()}
                                  >
                                    <WorkspacePreviewTransitionGuardProvider>
                                      <SettingsModalProvider>
                                        <DiagnosticsPanelProvider>
                                          <TaskWorkflowActionsContext.Provider
                                            value={createTaskWorkflowActionsFixture(
                                              options.taskWorkflowActions,
                                            )}
                                          >
                                            <Routes>
                                              <Route element={<AppShell />}>
                                                <Route
                                                  path="/kanban"
                                                  element={<main>Kanban</main>}
                                                />
                                                <Route
                                                  path="/sessions"
                                                  element={
                                                    options.sessionContent ? (
                                                      <div key={currentWorkspace?.workspaceId}>
                                                        {options.sessionContent}
                                                      </div>
                                                    ) : (
                                                      <main>Sessions</main>
                                                    )
                                                  }
                                                />
                                                <Route
                                                  path="/onboarding"
                                                  element={<Navigate to="/kanban" replace />}
                                                />
                                              </Route>
                                            </Routes>
                                          </TaskWorkflowActionsContext.Provider>
                                        </DiagnosticsPanelProvider>
                                      </SettingsModalProvider>
                                    </WorkspacePreviewTransitionGuardProvider>
                                  </WorkspaceActivityContext.Provider>
                                </NotificationContext.Provider>
                              </AgentSessionsContext.Provider>
                            </TaskControlContext.Provider>
                          </TasksStateContext.Provider>
                        </ChecksStateContext.Provider>
                      </DiagnosticsAutoOpenProvider>
                    </HostRuntimeStatusContext.Provider>
                  </RuntimeDefinitionsContext.Provider>
                </WorkspaceBranchStateContext.Provider>
              </WorkspaceStateContext.Provider>
            </WorkspacePresenceContext.Provider>
          </ActiveWorkspaceContext.Provider>
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const renderAppShellForTest = (
  options: RenderAppShellForTestOptions = {},
): ReturnType<typeof render> => {
  const queryClient = createQueryClient();
  const settingsSnapshot = createSettingsSnapshotFixture();
  queryClient.setQueryData(settingsSnapshotQueryOptions().queryKey, settingsSnapshot);
  queryClient.setQueryData(
    repoConfigQueryOptions(activeWorkspace.workspaceId).queryKey,
    activeRepoConfig,
  );
  queryClient.setQueryData(runtimeDefinitionsQueryOptions().queryKey, [
    OPENCODE_RUNTIME_DESCRIPTOR,
    CODEX_RUNTIME_DESCRIPTOR,
    CLAUDE_RUNTIME_DESCRIPTOR,
  ]);
  for (const kind of ["opencode", "codex", "claude"] as const) {
    queryClient.setQueryData(runtimeExecutableQueryOptions(kind, "").queryKey, {
      kind,
      path: "",
      ok: false,
      version: null,
      error: "Path is empty.",
    });
  }
  // Keep the seeded listing fresh for the whole test. A stale refetch would call the unconfigured host bridge.
  queryClient.setQueryData(
    filesystemQueryKeys.directory(),
    {
      currentPath: "/repo",
      currentPathIsGitRepo: true,
      parentPath: "/",
      homePath: "/repo",
      entries: [],
    },
    { updatedAt: Date.now() + 60_000 },
  );
  options.prepareQueryClient?.(queryClient);

  return render(
    <AppShellTestEnvironment
      options={options}
      queryClient={queryClient}
      settingsSnapshot={settingsSnapshot}
    />,
  );
};

let syntaxWorkerSpies: { mockRestore: () => void }[] = [];
beforeEach(() => {
  // Bun does not bundle the browser worker URL used by the syntax library.
  syntaxWorkerSpies = [
    spyOn(pierreReact, "WorkerPoolContextProvider").mockImplementation(({ children }) => (
      <>{children}</>
    )),
    spyOn(pierre, "preloadHighlighter").mockResolvedValue(undefined),
  ];
});
afterEach(() => {
  cleanup();
  for (const spy of syntaxWorkerSpies) spy.mockRestore();
});

describe("AppShell", () => {
  beforeEach(() => {
    installLocalStorage(new MemoryStorage());
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          tasksList: async () => [],
          workspaceSessionListActive: async () => [],
          agentSessionsListForTasks: async () => [],
          workspaceGetGitProviderContext: async () => null,
        },
      }),
    );
  });

  afterEach(() => {
    cleanup();
    configureShellBridge(createUnavailableShellBridge());
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
      return;
    }

    Reflect.deleteProperty(globalThis, "localStorage");
  });

  test("keeps the active repo config loaded outside Agent Studio", () => {
    const queryClients: QueryClient[] = [];
    renderAppShellForTest({
      prepareQueryClient: (client) => {
        queryClients.push(client);
      },
    });

    const query = queryClients[0]?.getQueryCache().find({
      queryKey: repoConfigQueryOptions(activeWorkspace.workspaceId).queryKey,
      exact: true,
    });
    expect(query?.getObserversCount()).toBeGreaterThan(0);
  });

  test("waits for the workspace list before choosing an entry path", () => {
    renderAppShellForTest({ workspacePresence: { isLoadingWorkspaces: true } });

    expect(screen.getByRole("status").textContent).toContain("Loading workspaces");
    expect(screen.queryByText("Kanban")).toBeNull();
  });

  test("does not open the repository modal while selecting an existing workspace on startup", async () => {
    renderAppShellForTest({ initiallyUnselectedWorkspace: true });

    await waitFor(() => expect(screen.getByText("OpenDucktor", { selector: "p" })).toBeTruthy());
    expect(screen.queryByRole("dialog", { name: "Open a repository" })).toBeNull();
  });

  test("opens the repository modal when only closed workspaces exist", () => {
    renderAppShellForTest({ closedOnly: true });

    expect(screen.getByRole("dialog", { name: "Open a repository" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Reopen a workspace" })).toBeTruthy();
  });

  test("shows the workspace load failure when no cached workspace exists", () => {
    renderAppShellForTest({
      workspacePresence: {
        hasWorkspaces: false,
        hasLoadedWorkspaceList: false,
        workspaceLoadError: new Error("Workspace list unavailable"),
      },
    });

    expect(
      screen.getByRole("heading", { name: "OpenDucktor could not load your workspaces" }),
    ).toBeTruthy();
    expect(screen.getByText("Workspace list unavailable")).toBeTruthy();
    expect(screen.queryByText("Kanban")).toBeNull();
  });

  test("keeps a failed workspace retry on the recoverable error screen", async () => {
    const retryWorkspaces = mock(async () => {
      throw new Error("Workspace list still unavailable");
    });
    renderAppShellForTest({
      workspacePresence: {
        hasWorkspaces: false,
        hasLoadedWorkspaceList: false,
        workspaceLoadError: new Error("Workspace list unavailable"),
        retryWorkspaces,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(retryWorkspaces).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole("heading", { name: "OpenDucktor could not load your workspaces" }),
    ).toBeTruthy();
  });

  test("keeps cached workspaces visible after a background refresh fails", () => {
    renderAppShellForTest({
      workspacePresence: { workspaceLoadError: new Error("Workspace refresh unavailable") },
    });

    expect(document.querySelector("main")?.textContent).toBe("Kanban");
    expect(
      screen.queryByRole("heading", { name: "OpenDucktor could not load your workspaces" }),
    ).toBeNull();
  });

  test("keeps onboarding visible when a cached empty workspace list refresh fails", () => {
    renderAppShellForTest({
      initialEntry: "/onboarding",
      workspacePresence: {
        hasWorkspaces: false,
        workspaceLoadError: new Error("Workspace refresh unavailable"),
      },
    });

    expect(
      screen.getByRole("heading", { name: "Set up your local coding workspace" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "OpenDucktor could not load your workspaces" }),
    ).toBeNull();
  });

  test("redirects an empty workspace from kanban to onboarding", async () => {
    renderAppShellForTest({ workspacePresence: { hasWorkspaces: false } });

    await waitFor(() =>
      expect(screen.getByTestId("current-route").textContent).toBe("/onboarding"),
    );
    expect(
      screen.getByRole("heading", { name: "Set up your local coding workspace" }),
    ).toBeTruthy();
    expect(screen.queryByText("Kanban")).toBeNull();
  });

  test("redirects onboarding to kanban when a workspace exists", async () => {
    renderAppShellForTest({ initialEntry: "/onboarding" });

    await waitFor(() => expect(screen.getByTestId("current-route").textContent).toBe("/kanban"));
    expect(document.querySelector("main")?.textContent).toBe("Kanban");
    expect(
      screen.queryByRole("heading", { name: "Set up your local coding workspace" }),
    ).toBeNull();
  });

  test("exits onboarding only after workspace creation publishes the active workspace", async () => {
    const workspaceAddResult = createDeferred<WorkspaceRecord>();
    const initialTaskLoad = createDeferred<void>();
    const platformLoad = createDeferred<void>();
    const workspaceAdd = mock(async () => workspaceAddResult.promise);
    const createdWorkspace = {
      ...activeWorkspace,
      workspaceId: "repo",
      workspaceName: "repo",
    } satisfies WorkspaceRecord;
    renderAppShellForTest({
      workspacePresence: { hasWorkspaces: false },
      workspaceAdd,
      prepareQueryClient: (queryClient) => {
        void queryClient.fetchQuery({
          ...repoTaskDataQueryOptions(createdWorkspace.repoPath),
          queryFn: async () => {
            await initialTaskLoad.promise;
            return { tasks: [] };
          },
        });
        void queryClient.fetchQuery({
          ...platformQueryOptions(),
          queryFn: async () => {
            await platformLoad.promise;
            return "darwin" as const;
          },
        });
      },
    });

    await waitFor(() =>
      expect(screen.getByTestId("current-route").textContent).toBe("/onboarding"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Configure coding agents" }));
    await screen.findByRole("heading", { name: "Configure coding agents" });
    fireEvent.click(screen.getByRole("button", { name: "Continue to notifications" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue without a coding agent" }));
    await screen.findByRole("heading", {
      name: "Configure notifications",
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue to workspace" }));
    await screen.findByRole("heading", { name: "Open your first workspace" });
    const selectionActions = await screen.findByTestId("onboarding-workspace-actions");
    const workspaceContent = screen.getByTestId("onboarding-workspace-content");
    const workspaceFooter = screen.getByTestId("onboarding-workspace-footer");
    expect(workspaceContent.contains(workspaceFooter)).toBe(false);
    expect(workspaceFooter.parentElement).toBe(workspaceContent.parentElement);
    expect(workspaceFooter.contains(selectionActions)).toBe(true);
    expect(
      within(workspaceFooter).getByRole("button", { name: "Back to notifications" }),
    ).toBeTruthy();
    expect(screen.queryByText("Choose a local Git repository to continue.")).toBeNull();
    fireEvent.click(within(workspaceFooter).getByRole("button", { name: "Choose This Folder" }));
    const submitActions = await screen.findByTestId("onboarding-workspace-actions");
    expect(workspaceFooter.contains(submitActions)).toBe(true);
    expect(within(workspaceFooter).getByRole("button", { name: "Back" })).toBeTruthy();
    expect(workspaceAdd).not.toHaveBeenCalled();
    fireEvent.click(
      await within(workspaceFooter).findByRole("button", { name: "Skip Git provider setup" }),
    );
    fireEvent.click(
      await within(workspaceFooter).findByRole("button", { name: "Continue to models" }),
    );
    const openRepositoryButton = await within(workspaceFooter).findByRole("button", {
      name: "Open repository",
    });
    fireEvent.click(openRepositoryButton);

    expect(await screen.findByRole("button", { name: "Creating workspace..." })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Back" }).disabled).toBe(true);
    expect(screen.getByTestId("current-route").textContent).toBe("/onboarding");
    expect(screen.queryByText("Kanban")).toBeNull();
    expect(workspaceAdd).toHaveBeenCalledWith({
      repoPath: "/repo",
      workspaceId: "repo",
      workspaceName: "repo",
    });

    const mainFrames: string[] = [];
    const frameObserver = new MutationObserver(() => {
      mainFrames.push(document.querySelector("main")?.textContent ?? "");
    });
    frameObserver.observe(document.body, { childList: true, subtree: true });

    await act(async () => {
      workspaceAddResult.resolve(createdWorkspace);
      await workspaceAddResult.promise;
      await Promise.resolve();
    });

    expect(screen.getByTestId("current-route").textContent).toBe("/onboarding");
    expect(screen.getByText("Preparing your workspace…")).toBeTruthy();

    await act(async () => {
      initialTaskLoad.resolve();
      await initialTaskLoad.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByTestId("current-route").textContent).toBe("/onboarding");

    platformLoad.resolve();

    await waitFor(() => expect(screen.getByTestId("current-route").textContent).toBe("/kanban"));
    frameObserver.disconnect();
    expect(document.querySelector("main")?.textContent).toBe("Kanban");
    expect(mainFrames).not.toContain("");
    expect(screen.queryByRole("heading", { name: "Open your first workspace" })).toBeNull();
    // This flow renders the app shell and several onboarding stages.
  }, 2_500);

  test("keeps the workspace draft in onboarding after a pending add fails", async () => {
    const workspaceAddResult = createDeferred<WorkspaceRecord>();
    const workspaceAdd = mock(async () => workspaceAddResult.promise);
    renderAppShellForTest({
      workspacePresence: { hasWorkspaces: false },
      workspaceAdd,
    });

    await waitFor(() =>
      expect(screen.getByTestId("current-route").textContent).toBe("/onboarding"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Configure coding agents" }));
    await screen.findByRole("heading", { name: "Configure coding agents" });
    fireEvent.click(screen.getByRole("button", { name: "Continue to notifications" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue without a coding agent" }));
    await screen.findByRole("heading", {
      name: "Configure notifications",
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue to workspace" }));
    await screen.findByRole("heading", { name: "Open your first workspace" });
    fireEvent.click(await screen.findByRole("button", { name: "Choose This Folder" }));
    fireEvent.click(await screen.findByRole("button", { name: "Skip Git provider setup" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue to models" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open repository" }));

    const backButton = screen.getByRole("button", { name: "Back" });
    if (!(backButton instanceof HTMLButtonElement)) {
      throw new TypeError("Expected the back action to be a button.");
    }
    await waitFor(() => expect(backButton.disabled).toBe(true));

    workspaceAddResult.reject(new Error("Repository open failed"));

    await screen.findByText("Repository open failed");
    expect(screen.getByTestId("current-route").textContent).toBe("/onboarding");
    expect(screen.getByLabelText<HTMLInputElement>("Repository path").value).toBe("/repo");
    expect(backButton.disabled).toBe(false);
    // This flow renders the app shell and several onboarding stages.
  }, 2_500);

  test("moves from welcome to runtime setup without mounting the workspace shell", () => {
    renderAppShellForTest({ workspacePresence: { hasWorkspaces: false } });

    fireEvent.click(screen.getByRole("button", { name: "Configure coding agents" }));

    expect(screen.getByRole("heading", { name: "Configure coding agents" })).toBeTruthy();
    expect(screen.getAllByText("Executable path")).toHaveLength(3);
    expect(screen.queryByText("Kanban")).toBeNull();
  });

  test("opens the sidebar by default when no preference is stored", () => {
    renderAppShellForTest();

    expect(screen.getByRole("button", { name: "Hide sidebar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show sidebar" })).toBeNull();
    expect(globalThis.localStorage.getItem(LEFT_SIDEBAR_STORAGE_KEY)).toBeNull();
  });

  test("exposes the sidebar state to the shell layout", () => {
    renderAppShellForTest();

    const mainContent = document.querySelector('[data-main-scroll-container="true"]');
    const shellRoot = mainContent?.closest(".app-shell");

    expect(shellRoot?.getAttribute("data-sidebar-state")).toBe("open");

    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));

    expect(shellRoot?.getAttribute("data-sidebar-state")).toBe("collapsed");
  });

  test("hides the scrollbar on the open sidebar scroll region", () => {
    renderAppShellForTest();

    const sessionList = document.querySelector('[data-sidebar-scroll-region="sessions"]');

    expect(sessionList?.className).toContain("hide-scrollbar");
    expect(sessionList?.className).toContain("overflow-y-auto");
  });

  test("keeps the settings trigger available when the sidebar is collapsed", async () => {
    renderAppShellForTest();

    await waitFor(() => expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));

    const collapsedSettingsButton = screen.getByRole("button", { name: "Settings" });
    expect(collapsedSettingsButton.getAttribute("aria-label")).toBe("Settings");
    expect(collapsedSettingsButton.getAttribute("title")).toBe("Settings");
    expect(collapsedSettingsButton.textContent?.trim()).toBe("");
  });

  test("keeps diagnostics available as a status-colored collapsed sidebar trigger", async () => {
    globalThis.localStorage.setItem(LEFT_SIDEBAR_STORAGE_KEY, "collapsed");

    renderAppShellForTest({ runtimeDefinitionsError: "Runtime definitions failed" });

    // Critical diagnostics auto-open the modal sheet, so Radix hides background controls.
    const diagnosticsButton = screen.getByRole("button", {
      hidden: true,
      name: "Open diagnostics: Critical issue",
    });
    const diagnosticsIcon = diagnosticsButton.querySelector("svg");
    expect(diagnosticsButton.getAttribute("title")).toBe("Open diagnostics: Critical issue");
    expect(diagnosticsButton.textContent?.trim()).toBe("");
    expect(diagnosticsIcon?.getAttribute("class")).toContain("text-destructive-accent");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Diagnostics" })).toBeTruthy());
  });

  test("shows checking state in the collapsed diagnostics trigger", () => {
    globalThis.localStorage.setItem(LEFT_SIDEBAR_STORAGE_KEY, "collapsed");

    renderAppShellForTest({ isLoadingRuntimeDefinitions: true });

    const diagnosticsButton = screen.getByRole("button", {
      name: "Open diagnostics: Checking...",
    });
    const diagnosticsIcon = diagnosticsButton.querySelector("svg");
    expect(diagnosticsIcon?.getAttribute("class")).toContain("animate-spin");
  });

  test("opens diagnostics from the collapsed sidebar trigger", async () => {
    globalThis.localStorage.setItem(LEFT_SIDEBAR_STORAGE_KEY, "collapsed");

    renderAppShellForTest();

    fireEvent.click(screen.getByRole("button", { name: /^Open diagnostics: / }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Diagnostics" })).toBeTruthy());
  });

  test("does not auto-open diagnostics again after dismissing and toggling the sidebar", async () => {
    renderAppShellForTest({ runtimeDefinitionsError: "Runtime definitions failed" });

    await waitFor(() => expect(screen.getByRole("heading", { name: "Diagnostics" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Diagnostics" })).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));

    expect(screen.getByRole("button", { name: "Show sidebar" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Diagnostics" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));

    expect(screen.getByRole("button", { name: "Hide sidebar" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Diagnostics" })).toBeNull();
  });

  test("stores collapsed and restores the collapsed sidebar after remount", () => {
    const view = renderAppShellForTest();

    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));

    expect(screen.getByRole("button", { name: "Show sidebar" })).toBeTruthy();
    expect(globalThis.localStorage.getItem(LEFT_SIDEBAR_STORAGE_KEY)).toBe("collapsed");

    view.unmount();
    renderAppShellForTest();

    expect(screen.getByRole("button", { name: "Show sidebar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hide sidebar" })).toBeNull();
  });

  test("stores opened and restores the opened sidebar after remount", () => {
    globalThis.localStorage.setItem(LEFT_SIDEBAR_STORAGE_KEY, "collapsed");
    const view = renderAppShellForTest();

    expect(screen.getByRole("button", { name: "Show sidebar" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));

    expect(screen.getByRole("button", { name: "Hide sidebar" })).toBeTruthy();
    expect(globalThis.localStorage.getItem(LEFT_SIDEBAR_STORAGE_KEY)).toBe("opened");

    view.unmount();
    renderAppShellForTest();

    expect(screen.getByRole("button", { name: "Hide sidebar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show sidebar" })).toBeNull();
  });

  test("defaults opened when the stored sidebar preference is invalid", () => {
    globalThis.localStorage.setItem(LEFT_SIDEBAR_STORAGE_KEY, "{bad-json");

    renderAppShellForTest();

    expect(screen.getByRole("button", { name: "Hide sidebar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show sidebar" })).toBeNull();
  });

  test("defaults opened when storage cannot be read", () => {
    const getItem = mock(() => {
      throw new Error("read failed");
    });
    installLocalStorage(new MemoryStorage({ getItem }));
    const originalConsoleError = console.error;
    const consoleError = mock(() => undefined);
    console.error = consoleError;
    const toastError = spyOn(toast, "error").mockReturnValue("storage-error");

    try {
      renderAppShellForTest();

      expect(screen.getByRole("button", { name: "Hide sidebar" })).toBeTruthy();
      expect(getItem).toHaveBeenCalledWith(LEFT_SIDEBAR_STORAGE_KEY);
      expect(consoleError).toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith("Could not restore the session list scope.", {
        description: "Allow local storage for this app, then reload. read failed",
      });
    } finally {
      console.error = originalConsoleError;
      toastError.mockRestore();
    }
  });

  test("keeps sidebar toggling in memory when storage cannot be written", () => {
    const setItem = mock(() => {
      throw new Error("write failed");
    });
    installLocalStorage(new MemoryStorage({ setItem }));
    const originalConsoleError = console.error;
    const consoleError = mock(() => undefined);
    console.error = consoleError;

    try {
      renderAppShellForTest();

      fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));

      expect(screen.getByRole("button", { name: "Show sidebar" })).toBeTruthy();
      expect(setItem).toHaveBeenCalledWith(LEFT_SIDEBAR_STORAGE_KEY, "collapsed");
      expect(consoleError).toHaveBeenCalled();
    } finally {
      console.error = originalConsoleError;
    }
  });
});

describe("AppShell session navigation", () => {
  const secondWorkspace = {
    ...activeWorkspace,
    workspaceId: "workspace-2",
    workspaceName: "Fairnest",
    repoPath: "/fairnest",
    isActive: false,
  } satisfies WorkspaceRecord;
  const chat = (id: string, workingDirectory: string) => ({
    id,
    runtimeKind: "codex" as const,
    externalSessionId: `native-${id}`,
    executionTarget: { kind: "local_repo_root" as const, workingDirectory },
    roleSnapshot: null,
    selectedModel: null,
    generatedTitle: `Chat ${id}`,
    manualTitle: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    archivedAt: null,
  });

  beforeEach(() => {
    installLocalStorage(new MemoryStorage());
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          tasksList: async () => [],
          agentSessionsListForTasks: async () => [],
          workspaceGetGitProviderContext: async () => null,
          workspaceSessionListActive: async (workspaceId) =>
            workspaceId === activeWorkspace.workspaceId
              ? [chat("mine", activeWorkspace.repoPath)]
              : [chat("theirs", secondWorkspace.repoPath)],
        },
      }),
    );
  });

  afterEach(() => {
    cleanup();
    configureShellBridge(createUnavailableShellBridge());
  });

  test("keeps Kanban, New task, and Settings without page links for sessions or a branch selector", async () => {
    renderAppShellForTest();

    await screen.findByRole("button", { name: /Chat mine/ });
    expect(screen.getByRole("link", { name: "Kanban" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Workflows" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Chats" })).toBeNull();
    expect(screen.queryByText("Branch")).toBeNull();
    expect(screen.getByRole("button", { name: "New task in OpenDucktor" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Settings/ })).toBeTruthy();
  });

  test("keeps unlisted workspaces and their recovery in the collapsed all-workspaces list", async () => {
    globalThis.localStorage.setItem(LEFT_SIDEBAR_STORAGE_KEY, "collapsed");
    renderAppShellForTest({
      closedWorkspaces: [{ ...secondWorkspace, workspaceName: "Archive" }],
      incompleteRemovals: [
        {
          workspace: { ...secondWorkspace, workspaceId: "workspace-3", workspaceName: "Old" },
          record: { removeTaskWorktrees: false, phase: "attachments", pendingWorktreePath: null },
        },
      ],
    });

    expect(screen.queryByRole("button", { name: "2 workspaces are not listed" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show sessions of all workspaces" }));
    fireEvent.click(await screen.findByRole("button", { name: "2 workspaces are not listed" }));

    const details = await screen.findByRole("dialog");
    expect(details.textContent).toContain("Not listed because they are closed: Archive.");
    expect(details.textContent).toContain("Old is not listed because its removal is incomplete.");
    fireEvent.click(within(details).getByRole("button", { name: "Reopen a workspace" }));
    expect(await screen.findByRole("heading", { name: "Reopen a workspace" })).toBeTruthy();
  });

  test.each(["opened", "collapsed"])(
    "saves the scope from the %s sidebar and restores its session list after remount",
    async (sidebar) => {
      globalThis.localStorage.setItem(LEFT_SIDEBAR_STORAGE_KEY, sidebar);
      const view = renderAppShellForTest({ extraWorkspaces: [secondWorkspace] });
      const role = sidebar === "opened" ? "radio" : "button";

      await screen.findByRole("button", { name: /Chat mine/ });
      expect(screen.queryByRole("button", { name: /Chat theirs/ })).toBeNull();

      fireEvent.click(screen.getByRole(role, { name: "Show sessions of all workspaces" }));
      await screen.findByRole("button", { name: /Chat theirs/ });
      expect(globalThis.localStorage.getItem(SESSION_SCOPE_STORAGE_KEY)).toBe("all");

      view.unmount();
      const restored = renderAppShellForTest({ extraWorkspaces: [secondWorkspace] });
      await screen.findByRole("button", { name: /Chat theirs/ });
      expect(screen.getByRole("button", { name: /Chat mine/ })).toBeTruthy();
      expect(
        screen
          .getByRole(role, { name: "Show sessions of all workspaces" })
          .getAttribute(sidebar === "opened" ? "aria-checked" : "aria-pressed"),
      ).toBe("true");

      fireEvent.click(
        screen.getByRole(role, {
          name:
            sidebar === "opened"
              ? "Show sessions of OpenDucktor"
              : "Show sessions of all workspaces",
        }),
      );
      await waitFor(() => expect(screen.queryByRole("button", { name: /Chat theirs/ })).toBeNull());
      expect(globalThis.localStorage.getItem(SESSION_SCOPE_STORAGE_KEY)).toBe("current");

      restored.unmount();
      renderAppShellForTest({ extraWorkspaces: [secondWorkspace] });
      await screen.findByRole("button", { name: /Chat mine/ });
      expect(screen.queryByRole("button", { name: /Chat theirs/ })).toBeNull();
      expect(
        screen
          .getByRole(role, { name: "Show sessions of all workspaces" })
          .getAttribute(sidebar === "opened" ? "aria-checked" : "aria-pressed"),
      ).toBe("false");
    },
  );

  test("uses the current workspace when the saved scope is unknown", async () => {
    globalThis.localStorage.setItem(SESSION_SCOPE_STORAGE_KEY, "unknown");
    renderAppShellForTest({ extraWorkspaces: [secondWorkspace] });

    await screen.findByRole("button", { name: /Chat mine/ });
    expect(screen.queryByRole("button", { name: /Chat theirs/ })).toBeNull();
    expect(
      screen
        .getByRole("radio", { name: "Show sessions of OpenDucktor" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(globalThis.localStorage.getItem(SESSION_SCOPE_STORAGE_KEY)).toBe("unknown");
  });

  test("reports a failed scope save and keeps the current session list", async () => {
    installLocalStorage(
      new MemoryStorage({
        setItem: () => {
          throw new Error("write failed");
        },
      }),
    );
    const toastError = spyOn(toast, "error").mockReturnValue("storage-error");
    try {
      renderAppShellForTest({ extraWorkspaces: [secondWorkspace] });
      await screen.findByRole("button", { name: /Chat mine/ });

      fireEvent.click(screen.getByRole("radio", { name: "Show sessions of all workspaces" }));

      expect(toastError).toHaveBeenCalledWith("Could not save the session list scope.", {
        description: "Allow local storage for this app, then try again. write failed",
      });
      expect(screen.queryByRole("button", { name: /Chat theirs/ })).toBeNull();
      expect(
        screen
          .getByRole("radio", { name: "Show sessions of OpenDucktor" })
          .getAttribute("aria-checked"),
      ).toBe("true");
    } finally {
      toastError.mockRestore();
    }
  });

  test("opens a sidebar session on the Sessions page", async () => {
    renderAppShellForTest();

    fireEvent.click(await screen.findByRole("button", { name: /Chat mine/ }));

    await waitFor(() =>
      expect(screen.getByTestId("current-address").textContent).toBe(
        "/sessions?workspace=workspace-1&kind=workspace&session=mine",
      ),
    );
  });

  test("shows cached transcript rows on the first render after page and workspace switches", async () => {
    const sessions = [activeWorkspace, secondWorkspace].map((workspace) =>
      buildSession({
        externalSessionId: "same-native-id",
        workingDirectory: workspace.repoPath,
        messages: createSessionMessagesState(
          "same-native-id",
          Array.from({ length: 500 }, (_, index) =>
            buildMessage(
              index % 2 === 0 ? "user" : "assistant",
              `${workspace.workspaceName} message ${index}`,
              { id: `message-${index}` },
            ),
          ),
          1,
        ),
      }),
    );
    const renders: { workspaceId: string; missing: boolean }[] = [];
    function Transcript() {
      const { activeWorkspace: workspace } = useActiveWorkspaceContext();
      const session =
        workspace?.workspaceId === secondWorkspace.workspaceId ? sessions[1]! : sessions[0]!;
      const model = useAgentChatTranscriptModel({ session, showThinkingMessages: true });
      renders.push({
        workspaceId: workspace!.workspaceId,
        missing: model.isTranscriptModelMissing,
      });
      const firstRow = model.transcriptState.rows[0];
      return (
        <>
          <Link to="/kanban">Return to Kanban</Link>
          <p>
            {firstRow?.kind === "message" ? firstRow.message.content : "Preparing conversation"}
          </p>
        </>
      );
    }
    renderAppShellForTest({
      initialEntry: "/sessions?workspace=workspace-1&kind=workspace&session=mine",
      extraWorkspaces: [secondWorkspace],
      sessionContent: <Transcript />,
      prepareQueryClient: (client) => {
        client.setQueryData(repoConfigQueryOptions(secondWorkspace.workspaceId).queryKey, {
          ...activeRepoConfig,
          workspaceId: secondWorkspace.workspaceId,
          workspaceName: secondWorkspace.workspaceName,
          repoPath: secondWorkspace.repoPath,
        });
      },
    });
    await screen.findByText("OpenDucktor message 0");
    fireEvent.click(screen.getByRole("link", { name: "Return to Kanban" }));
    const beforePageReturn = renders.length;
    fireEvent.click(await screen.findByRole("button", { name: /Chat mine/ }));
    await screen.findByText("OpenDucktor message 0");
    expect(renders[beforePageReturn]?.missing).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Fairnest" }));
    await screen.findByText("Fairnest message 0");
    const beforeWorkspaceReturn = renders.length;
    fireEvent.click(screen.getByRole("button", { name: "OpenDucktor" }));
    await screen.findByText("OpenDucktor message 0");
    expect(renders[beforeWorkspaceReturn]).toEqual({
      workspaceId: activeWorkspace.workspaceId,
      missing: false,
    });
  });

  test("keeps syntax workers alive through page and workspace switches", async () => {
    const startWorkers = mock();
    const stopWorkers = mock();
    const workerProvider = spyOn(diffWorkers, "DiffWorkerProvider").mockImplementation(
      function Workers({ children }) {
        useEffect(() => {
          startWorkers();
          return () => stopWorkers();
        }, []);
        return <>{children}</>;
      },
    );
    try {
      const view = renderAppShellForTest({ extraWorkspaces: [secondWorkspace] });
      expect(startWorkers).toHaveBeenCalledTimes(1);
      fireEvent.click(await screen.findByRole("button", { name: /Chat mine/ }));
      await screen.findByText("Sessions");
      fireEvent.click(screen.getByRole("button", { name: "Fairnest" }));
      await screen.findByRole("button", { name: "New task in Fairnest" });
      fireEvent.click(screen.getByRole("link", { name: "Kanban" }));
      await waitFor(() =>
        expect(screen.getByTestId("current-address").textContent).toBe("/kanban"),
      );
      expect(startWorkers).toHaveBeenCalledTimes(1);
      expect(stopWorkers).not.toHaveBeenCalled();
      view.unmount();
      expect(stopWorkers).toHaveBeenCalledTimes(1);
    } finally {
      workerProvider.mockRestore();
    }
  });

  test("keeps the list scope and session access when the sidebar collapses", async () => {
    renderAppShellForTest({ extraWorkspaces: [secondWorkspace] });
    await screen.findByRole("button", { name: /Chat mine/ });
    fireEvent.click(screen.getByRole("radio", { name: "Show sessions of all workspaces" }));
    await screen.findByRole("button", { name: /Chat theirs/ });

    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));

    expect(
      screen
        .getByRole("button", { name: "Show sessions of all workspaces" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: /Chat theirs/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kanban" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More actions for OpenDucktor" }));
    const menu = await screen.findByRole("dialog");
    expect(within(menu).getByRole("button", { name: "New task" })).toBeTruthy();

    fireEvent.keyDown(menu, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Show sessions of all workspaces" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Chat theirs/ })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(
      screen
        .getByRole("radio", { name: "Show sessions of OpenDucktor" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });
});

describe("AppShell command palette", () => {
  const fairnest = {
    ...activeWorkspace,
    workspaceId: "workspace-2",
    workspaceName: "Fairnest",
    repoPath: "/fairnest",
    isActive: false,
  } satisfies WorkspaceRecord;
  const ownTask = createTaskCardFixture({
    id: "odt-own",
    title: "Polish the command palette",
    status: "in_progress",
    issueType: "feature",
    labels: ["ux"],
    availableActions: ["build_start", "open_builder", "reset_task", "close_task"],
  });
  const fairnestTask = createTaskCardFixture({
    id: "fair-1",
    title: "Fix checkout totals",
    status: "ready_for_dev",
    availableActions: ["build_start"],
  });
  const closedTask = createTaskCardFixture({
    id: "odt-closed",
    title: "Archive old builds",
    status: "closed",
    availableActions: [],
  });
  const builderSession = {
    externalSessionId: "build-1",
    role: "build",
    startedAt: "2026-03-01T00:00:00.000Z",
    runtimeKind: "opencode",
    workingDirectory: "/repo/worktree",
    selectedModel: null,
  } satisfies AgentSessionRecord;

  const renderPalette = (
    options: RenderAppShellForTestOptions = {},
    platform: "darwin" | "linux" = "darwin",
  ) =>
    renderAppShellForTest({
      extraWorkspaces: [fairnest],
      tasksByRepoPath: { "/repo": [ownTask, closedTask], "/fairnest": [fairnestTask] },
      prepareQueryClient: (queryClient) => {
        queryClient.setQueryData(platformQueryOptions().queryKey, platform);
        queryClient.setQueryData(repoTaskDataQueryOptions("/repo").queryKey, {
          tasks: [ownTask, closedTask],
        });
        queryClient.setQueryData(agentSessionQueryKeys.list("/repo", closedTask.id), [
          { ...builderSession, externalSessionId: "build-closed" },
        ]);
        queryClient.setQueryData(repoTaskDataQueryOptions("/fairnest").queryKey, {
          tasks: [fairnestTask],
        });
        queryClient.setQueryData(agentSessionQueryKeys.list("/repo", ownTask.id), [builderSession]);
        queryClient.setQueryData(agentSessionQueryKeys.list("/fairnest", fairnestTask.id), []);
      },
      ...options,
    });

  const pressShortcut = (modifier: "metaKey" | "ctrlKey" = "metaKey"): void => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "k", [modifier]: true });
  };
  const openPalette = async (modifier: "metaKey" | "ctrlKey" = "metaKey"): Promise<HTMLElement> => {
    pressShortcut(modifier);
    return screen.findByRole("dialog", { name: "Command palette" });
  };
  const search = (palette: HTMLElement, query: string): HTMLInputElement => {
    const input = within(palette).getByRole<HTMLInputElement>("combobox");
    fireEvent.change(input, { target: { value: query } });
    return input;
  };
  const selectedOption = (palette: HTMLElement): HTMLElement | undefined =>
    within(palette)
      .getAllByRole("option")
      .find((option) => option.getAttribute("aria-selected") === "true");
  /** The input names the mounted option that is highlighted, so screen readers announce it. */
  const expectActiveOptionLinked = async (palette: HTMLElement, text: string): Promise<void> => {
    const input = within(palette).getByRole("combobox");
    await waitFor(() => {
      const selected = selectedOption(palette);
      expect(selected?.textContent).toContain(text);
      const linkedId = input.getAttribute("aria-activedescendant");
      expect(linkedId).toBe(selected?.id ?? "");
      expect(document.getElementById(linkedId ?? "")).toBe(selected ?? null);
    });
  };

  /**
   * Query results reach observers in a timer. waitFor cannot wait for a timer under Bun, so a
   * test that waits for a query result flushes it here.
   */
  const flushQueryUpdates = (): Promise<void> =>
    act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));

  const actionOption = (palette: HTMLElement, label: string): HTMLElement => {
    const option = within(palette)
      .getAllByRole("option")
      .find((entry) => entry.textContent?.startsWith(label));
    if (!option) throw new Error(`The palette shows no ${label} action.`);
    return option;
  };

  type PaletteHost = NonNullable<Parameters<typeof createShellBridgeFixture>[0]>["client"];
  /** A host with a healthy task store and no Git provider setup, unless a test overrides it. */
  const configurePaletteHost = (overrides: PaletteHost = {}): void => {
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          tasksList: async () => [],
          agentSessionsListForTasks: async () => [],
          taskStoreCheck: async () => createTaskStoreCheckFixture(),
          workspaceGetGitProviderContext: async () => null,
          workspaceSessionListActive: async () => [],
          ...overrides,
        },
      }),
    );
  };

  beforeEach(() => {
    installLocalStorage(new MemoryStorage());
    useRecentItemsStore.setState({ items: [], loadError: null });
    configurePaletteHost();
  });

  afterEach(() => {
    cleanup();
    useRecentItemsStore.setState({ items: [], loadError: null });
    configureShellBridge(createUnavailableShellBridge());
  });

  test("opens with the shortcut, starts with New task, and closes with the same keys", async () => {
    renderPalette();
    const palette = await openPalette();

    const input = within(palette).getByRole<HTMLInputElement>("combobox");
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("");
    expect(selectedOption(palette)?.textContent).toContain("New task");
    expect(within(palette).getByRole("button", { name: "Workspace filter: All workspaces" }));

    pressShortcut();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull(),
    );
  });

  test("opens from the sidebar search button and returns focus to it on Escape", async () => {
    renderPalette();
    const trigger = screen.getByRole("button", { name: "Search and run commands" });
    trigger.focus();

    fireEvent.click(trigger);
    const palette = await screen.findByRole("dialog", { name: "Command palette" });
    fireEvent.keyDown(within(palette).getByRole("combobox"), { key: "Escape" });
    // Radix returns focus in a timer after the dialog content unmounts.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
  });

  test("links the input to the highlighted option after open, keys, search, and view changes", async () => {
    renderPalette();
    const palette = await openPalette();
    const input = within(palette).getByRole("combobox");

    await expectActiveOptionLinked(palette, "New task");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    await expectActiveOptionLinked(palette, "New chat");
    search(palette, "polish");
    await expectActiveOptionLinked(palette, "Polish the command palette");
    fireEvent.keyDown(input, { key: "Tab" });
    await expectActiveOptionLinked(palette, "Open latest session");
    fireEvent.keyDown(input, { key: "Escape" });
    await expectActiveOptionLinked(palette, "Polish the command palette");
  });

  test("scrolls to the result that a search highlights and keeps the scroll on a data update", async () => {
    let queryClient: QueryClient | null = null;
    // More rows than the bounded list shows, so a move down leaves the first row out of view.
    const tasks = Array.from({ length: 12 }, (_, index) =>
      createTaskCardFixture({
        id: `alpha-${index}`,
        title: `Alpha task ${index}`,
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 12 - index)).toISOString(),
      }),
    );
    renderPalette({
      tasksByRepoPath: { "/repo": tasks },
      prepareQueryClient: (client) => {
        queryClient = client;
        client.setQueryData(platformQueryOptions().queryKey, "darwin");
        client.setQueryData(repoTaskDataQueryOptions("/repo").queryKey, { tasks });
        client.setQueryData(repoTaskDataQueryOptions("/fairnest").queryKey, { tasks: [] });
        for (const task of tasks) {
          client.setQueryData(agentSessionQueryKeys.list("/repo", task.id), []);
        }
      },
    });
    const palette = await openPalette();
    const input = search(palette, "alpha");
    await expectActiveOptionLinked(palette, "Alpha task 0");
    for (let step = 0; step < 8; step += 1) fireEvent.keyDown(input, { key: "ArrowDown" });
    await expectActiveOptionLinked(palette, "Alpha task 8");

    const scrolled: Element[] = [];
    const scrollIntoView = spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
      this: Element,
    ) {
      scrolled.push(this);
    });
    const scrolledIds = (): string[] => scrolled.map((element) => element.id);
    try {
      search(palette, "alph");
      await expectActiveOptionLinked(palette, "Alpha task 0");
      expect(scrolledIds()).toContain(selectedOption(palette)?.id ?? "");

      // The user scrolls away with the wheel. The next search keeps the same best result.
      scrolled.length = 0;
      search(palette, "alpha");
      await expectActiveOptionLinked(palette, "Alpha task 0");
      expect(scrolledIds()).toContain(selectedOption(palette)?.id ?? "");

      // A data update keeps the highlighted option, so it keeps the wheel scroll.
      scrolled.length = 0;
      await act(async () => {
        queryClient?.setQueryData(repoTaskDataQueryOptions("/repo").queryKey, {
          tasks: tasks.filter((task) => task.id !== "alpha-10"),
        });
      });
      await flushQueryUpdates();
      expect(within(palette).queryByText("Alpha task 10")).toBeNull();
      await expectActiveOptionLinked(palette, "Alpha task 0");
      expect(scrolled).toHaveLength(0);
    } finally {
      scrollIntoView.mockRestore();
    }
  });

  test("disables task creation with the reason when the task store check fails", async () => {
    configurePaletteHost({
      taskStoreCheck: async () => {
        throw new Error("task-store transport unavailable");
      },
    });
    const onCreateTask = mock(() => {});
    renderPalette({ taskWorkflowActions: { onCreateTask } });
    const palette = await openPalette();

    const reason = "Could not check the task store. task-store transport unavailable";
    await flushQueryUpdates();
    expect(actionOption(palette, "New task").getAttribute("aria-disabled")).toBe("true");
    expect(actionOption(palette, "New task").textContent).toContain(reason);
    expect(actionOption(palette, "Import tasks").getAttribute("aria-disabled")).toBe("true");
    search(palette, "Write docs");
    expect(actionOption(palette, "New task “Write docs”").getAttribute("aria-disabled")).toBe(
      "true",
    );

    fireEvent.click(actionOption(palette, "New task “Write docs”"));
    await flushQueryUpdates();
    expect(onCreateTask).not.toHaveBeenCalled();
  });

  test("disables import on a failed provider read and opens Settings only for missing setup", async () => {
    configurePaletteHost({
      workspaceGetGitProviderContext: async () => {
        throw new Error("provider context unavailable");
      },
    });
    const view = renderPalette();
    const palette = await openPalette();

    await flushQueryUpdates();
    expect(actionOption(palette, "Import tasks").textContent).toContain(
      "Could not read the Git provider. provider context unavailable",
    );
    expect(actionOption(palette, "Import tasks").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(actionOption(palette, "Import tasks"));
    await flushQueryUpdates();
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    view.unmount();

    configurePaletteHost();
    renderPalette();
    const setupPalette = await openPalette();
    await flushQueryUpdates();
    const importTasks = actionOption(setupPalette, "Import tasks");
    expect(importTasks.getAttribute("aria-disabled")).toBe("false");
    fireEvent.click(importTasks);
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeTruthy();
  });

  test("shows a failed session refresh of a workspace and keeps the other results", async () => {
    let queryClient: QueryClient | null = null;
    configurePaletteHost({
      // A refresh reads the session lists of the workspace in one batch.
      agentSessionsListForTasks: async () => {
        throw new Error("session refresh unavailable");
      },
    });
    renderPalette({
      prepareQueryClient: (client) => {
        queryClient = client;
        client.setQueryData(platformQueryOptions().queryKey, "darwin");
        client.setQueryData(repoTaskDataQueryOptions("/repo").queryKey, {
          tasks: [ownTask, closedTask],
        });
        client.setQueryData(repoTaskDataQueryOptions("/fairnest").queryKey, {
          tasks: [fairnestTask],
        });
        client.setQueryData(agentSessionQueryKeys.list("/repo", ownTask.id), [builderSession]);
        client.setQueryData(agentSessionQueryKeys.list("/repo", closedTask.id), []);
        client.setQueryData(agentSessionQueryKeys.list("/fairnest", fairnestTask.id), []);
      },
    });
    const palette = await openPalette();

    await act(async () => {
      await queryClient?.refetchQueries({
        queryKey: agentSessionQueryKeys.list("/repo", ownTask.id),
        exact: true,
      });
    });
    await flushQueryUpdates();

    // The palette shows the problem with the same text as the sidebar.
    expect(
      await within(palette).findByText(
        "OpenDucktor: Task sessions could not load. session refresh unavailable",
      ),
    ).toBeTruthy();
    search(palette, "checkout");
    expect(selectedOption(palette)?.textContent).toContain("Fix checkout totals");
    // The row marks the part of its title that the query found.
    expect(selectedOption(palette)?.querySelector("mark")?.textContent).toBe("checkout");
  });

  test.each([
    ["darwin", "metaKey"],
    ["linux", "ctrlKey"],
  ] as const)(
    "keeps the palette open when %s Mod+Enter has no next step for the task",
    async (platform, modifier) => {
      renderPalette({}, platform);
      const palette = await openPalette(modifier);
      const address = screen.getByTestId("current-address").textContent;

      const input = search(palette, "archive old");
      expect(selectedOption(palette)?.textContent).toContain("Archive old builds");
      expect(within(palette).getByText("Open details")).toBeTruthy();
      expect(within(palette).queryByText("↵", { selector: "kbd" })).toBeTruthy();
      expect(
        within(palette)
          .getAllByRole("button")
          .some((button) => button.textContent?.includes("Start")),
      ).toBe(false);

      fireEvent.keyDown(input, { key: "Enter", [modifier]: true });
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

      expect(screen.getByRole("dialog", { name: "Command palette" })).toBeTruthy();
      expect(screen.getByTestId("current-address").textContent).toBe(address);
    },
  );

  test("leaves the shortcut alone while another dialog is open", async () => {
    renderPalette();
    fireEvent.click(screen.getByRole("button", { name: /^Open diagnostics/ }));
    await screen.findByRole("dialog", { name: "Diagnostics" });

    pressShortcut();

    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
  });

  test("finds a task by its label and opens its latest session", async () => {
    renderPalette();
    const palette = await openPalette();

    search(palette, "ux");

    expect(selectedOption(palette)?.textContent).toContain("Polish the command palette");
    expect(within(palette).getByText("Open Builder session")).toBeTruthy();
    fireEvent.keyDown(within(palette).getByRole("combobox"), { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByTestId("current-address").textContent).toContain("session=build-1"),
    );
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
  });

  test("makes the workspace of a task active, then opens the task details on the same page", async () => {
    const onOpenTaskDetails = mock((_taskId: string) => {});
    renderPalette({ taskWorkflowActions: { onOpenTaskDetails } });
    const address = screen.getByTestId("current-address").textContent;
    const palette = await openPalette();

    search(palette, "checkout");
    expect(selectedOption(palette)?.textContent).toContain("in Fairnest");
    expect(within(palette).getByText("Open details")).toBeTruthy();
    fireEvent.keyDown(within(palette).getByRole("combobox"), { key: "Enter" });

    await waitFor(() => expect(onOpenTaskDetails).toHaveBeenCalledWith("fair-1"));
    expect(screen.getByTestId("current-address").textContent).toBe(address);
    const reopened = await openPalette();
    expect(actionOption(reopened, "New task").textContent).toContain("in Fairnest");
  });

  test("copies the ID of a task in another workspace and keeps the active workspace", async () => {
    const writeText = mock(async (_value: string) => {});
    const restoreClipboard = replaceNavigatorClipboard(writeText);
    try {
      renderPalette();
      const palette = await openPalette();
      const input = search(palette, "checkout");
      fireEvent.keyDown(input, { key: "Tab" });
      search(palette, "copy");
      expect(selectedOption(palette)?.textContent).toBe("Copy task ID");

      fireEvent.keyDown(input, { key: "Enter" });

      // The copy runs inside the key event, so a browser sees the user gesture.
      expect(writeText).toHaveBeenCalledWith(fairnestTask.id);
      await flushQueryUpdates();
      expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
      const reopened = await openPalette();
      expect(actionOption(reopened, "New task").textContent).toContain(
        `in ${activeWorkspace.workspaceName}`,
      );
    } finally {
      restoreClipboard();
    }
  });

  test("switches the task card view and marks the current view", async () => {
    const updateCardView = mock(async (taskCardView: "normal" | "compact") =>
      createSettingsSnapshotFixture({ kanban: { taskCardView } }),
    );
    configurePaletteHost({ workspaceUpdateKanbanTaskCardView: updateCardView });
    renderPalette();
    const palette = await openPalette();

    search(palette, "card view");
    expect(actionOption(palette, "Task cards: Normal").textContent).toContain(", current");
    expect(actionOption(palette, "Task cards: Compact").textContent).not.toContain(", current");

    search(palette, "density");
    expect(selectedOption(palette)?.textContent).toBe("Task cards: Compact");
    fireEvent.keyDown(within(palette).getByRole("combobox"), { key: "Enter" });
    await flushQueryUpdates();

    expect(updateCardView).toHaveBeenCalledWith("compact");
  });

  const chatSession: WorkspaceSession = {
    id: "chat-1",
    runtimeKind: "codex",
    externalSessionId: "native-chat-1",
    executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
    roleSnapshot: null,
    selectedModel: null,
    generatedTitle: "Release notes",
    manualTitle: null,
    createdAt: 1,
    lastActivityAt: 1,
    updatedAt: 1,
    archivedAt: null,
  };
  /** Opens the palette with one chat in the active workspace and searches for it. */
  const searchChat = async (): Promise<{ palette: HTMLElement; input: HTMLInputElement }> => {
    configurePaletteHost({
      workspaceSessionListActive: async (workspaceId) =>
        workspaceId === activeWorkspace.workspaceId ? [chatSession] : [],
    });
    renderPalette();
    const palette = await openPalette();
    await flushQueryUpdates();
    const input = search(palette, "release notes");
    expect(selectedOption(palette)?.textContent).toContain("Release notes");
    return { palette, input };
  };

  test("opens the chat actions with Tab and copies the external session ID", async () => {
    const writeText = mock(async (_value: string) => {});
    const restoreClipboard = replaceNavigatorClipboard(writeText);
    try {
      const { palette, input } = await searchChat();
      expect(within(palette).getByText("Rename")).toBeTruthy();

      fireEvent.keyDown(input, { key: "Tab" });

      expect(within(palette).getByPlaceholderText("Search chat actions…")).toBeTruthy();
      expect(
        within(palette)
          .getAllByRole("option")
          .map((option) => option.textContent),
      ).toEqual([
        "Open chat",
        "Mark as unread",
        "Rename chat",
        "Copy working directory",
        "Copy external session ID",
        "Archive chat",
      ]);
      search(palette, "external");
      fireEvent.keyDown(input, { key: "Enter" });

      expect(writeText).toHaveBeenCalledWith("native-chat-1");
      await flushQueryUpdates();
      expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
    } finally {
      restoreClipboard();
    }
  });

  test("renames a chat with Mod+E and archives it with the existing dialogs", async () => {
    const { input } = await searchChat();

    fireEvent.keyDown(input, { key: "e", metaKey: true });
    await flushQueryUpdates();
    const rename = await screen.findByRole("dialog", { name: "Rename chat" });
    fireEvent.keyDown(rename, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename chat" })).toBeNull());

    const palette = await openPalette();
    const reopened = search(palette, "release notes");
    fireEvent.keyDown(reopened, { key: "Tab" });
    search(palette, "archive");
    fireEvent.keyDown(reopened, { key: "Enter" });
    await flushQueryUpdates();

    expect(await screen.findByRole("dialog", { name: "Archive chat" })).toBeTruthy();
  });

  test("shows the sidebar status dot at the start of a task row with sessions", async () => {
    renderPalette();
    const palette = await openPalette();

    search(palette, "polish");
    const row = selectedOption(palette);
    if (!row) throw new Error("The palette highlights no task row.");

    const dot = within(row).getByRole("img", {
      name: /^(Session read|Unread session|Session running)$/,
    });
    expect(row.firstElementChild).toBe(dot);
  });

  test("opens the task actions with Tab and returns to the same results with Escape", async () => {
    renderPalette();
    const palette = await openPalette();
    const input = search(palette, "polish");

    fireEvent.keyDown(input, { key: "Tab" });

    const actions = within(palette)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(actions).toEqual([
      "Open latest sessionBuilder",
      "Open Builder session",
      "Start Builder",
      "Edit task",
      "Open task details",
      "Copy task ID",
      "Reset Task",
      "Delete task",
    ]);
    expect(input.value).toBe("");

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeTruthy();
    expect(input.value).toBe("polish");
    expect(selectedOption(palette)?.textContent).toContain("Polish the command palette");
  });

  test("edits the highlighted task and runs its next workflow step with the task keys", async () => {
    const onEdit = mock(() => {});
    const onOpenSession = mock(() => {});
    renderPalette({ taskWorkflowActions: { onEdit, onOpenSession } });

    search(await openPalette(), "polish");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "e", metaKey: true });
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith("odt-own"));

    search(await openPalette(), "polish");
    expect(screen.getByText("Open Builder")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter", metaKey: true });
    await waitFor(() =>
      expect(onOpenSession).toHaveBeenCalledWith("odt-own", "build", {
        session: expect.objectContaining({ externalSessionId: "build-1" }),
      }),
    );
  });

  test("creates a task from the query text", async () => {
    const onCreateTask = mock(() => {});
    renderPalette({ taskWorkflowActions: { onCreateTask } });
    const palette = await openPalette();

    search(palette, "Write release notes");
    const create = within(palette).getAllByRole("option").at(-1);
    if (!create) throw new Error("The palette shows no option to create a task.");
    expect(create.textContent).toContain("New task “Write release notes”");
    fireEvent.click(create);

    await waitFor(() =>
      expect(onCreateTask).toHaveBeenCalledWith({ initialTitle: "Write release notes" }),
    );
  });

  test("shows recent tasks after the actions and drops the ones that no longer exist", async () => {
    useRecentItemsStore.setState({
      items: [
        { kind: "task", workspaceId: fairnest.workspaceId, taskId: fairnestTask.id, openedAt: 3 },
        { kind: "task", workspaceId: activeWorkspace.workspaceId, taskId: "deleted", openedAt: 2 },
        { kind: "task", workspaceId: activeWorkspace.workspaceId, taskId: ownTask.id, openedAt: 1 },
      ],
    });
    renderPalette();
    const palette = await openPalette();

    const recent = await within(palette).findByRole("group", { name: "Recent" });
    expect(
      within(recent)
        .getAllByRole("option")
        .map((option) => option.textContent?.includes("Fix checkout totals")),
    ).toEqual([true, false]);
  });

  test("filters by workspace from the keyboard and targets that workspace", async () => {
    renderPalette();
    const palette = await openPalette();
    const input = within(palette).getByRole("combobox");

    fireEvent.keyDown(input, { key: "ArrowDown", altKey: true });
    fireEvent.click(await screen.findByRole("option", { name: "Fairnest" }));

    expect(
      await within(palette).findByRole("button", { name: "Workspace filter: Fairnest" }),
    ).toBeTruthy();
    expect(selectedOption(palette)?.textContent).toContain("New taskin Fairnest");
    search(palette, "polish");
    expect(within(palette).queryByText("Polish the command palette")).toBeNull();
  });
});
