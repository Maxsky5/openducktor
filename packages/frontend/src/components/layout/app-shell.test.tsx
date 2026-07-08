import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { createQueryClient } from "@/lib/query-client";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import {
  ActiveWorkspaceContext,
  AgentSessionsContext,
  ChecksStateContext,
  RepoRuntimeHealthContext,
  RuntimeDefinitionsContext,
  TasksStateContext,
  WorkspaceBranchStateContext,
  WorkspacePresenceContext,
  WorkspaceStateContext,
} from "@/state/app-state-contexts";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import type {
  ChecksStateContextValue,
  TasksStateContextValue,
  WorkspaceBranchStateContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";
import { AppShell } from "./app-shell";

const LEFT_SIDEBAR_STORAGE_KEY = "openducktor:app-shell:left-sidebar";

const activeWorkspace = {
  workspaceId: "workspace-1",
  workspaceName: "OpenDucktor",
  repoPath: "/repo",
  iconDataUrl: undefined,
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: null,
  effectiveWorktreeBasePath: null,
} satisfies WorkspaceRecord;

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

const createWorkspaceState = (): WorkspaceStateContextValue => ({
  isSwitchingWorkspace: false,
  isLoadingBranches: false,
  isSwitchingBranch: false,
  branchSyncDegraded: false,
  workspaces: [activeWorkspace],
  activeWorkspace,
  branches: [],
  activeBranch: null,
  addWorkspace: async () => undefined,
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
  saveSettingsSnapshot: async () => undefined,
});

const createWorkspaceBranchState = (): WorkspaceBranchStateContextValue => ({
  activeWorkspace,
  branches: [],
  activeBranch: null,
  isSwitchingWorkspace: false,
  isLoadingBranches: false,
  isSwitchingBranch: false,
  branchSyncDegraded: false,
  switchBranch: async () => undefined,
});

type RenderAppShellForTestOptions = {
  isLoadingRuntimeDefinitions?: boolean;
  runtimeDefinitionsError?: string | null;
};

const createChecksState = (): ChecksStateContextValue => ({
  runtimeCheck: null,
  taskStoreCheck: null,
  runtimeCheckFailureKind: null,
  taskStoreCheckFailureKind: null,
  isLoadingChecks: false,
  refreshChecks: async () => undefined,
});

const createTasksState = (): TasksStateContextValue => ({
  isForegroundLoadingTasks: false,
  isRefreshingTasksInBackground: false,
  isLoadingTasks: false,
  detectingPullRequestTaskId: null,
  linkingMergedPullRequestTaskId: null,
  unlinkingPullRequestTaskId: null,
  pendingMergedPullRequest: null,
  tasks: [],
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

const renderAppShellForTest = (
  options: RenderAppShellForTestOptions = {},
): ReturnType<typeof render> => {
  const queryClient = createQueryClient();
  const settingsSnapshot = createSettingsSnapshotFixture();
  queryClient.setQueryData(settingsSnapshotQueryOptions().queryKey, settingsSnapshot);

  return render(
    <MemoryRouter initialEntries={["/kanban"]} useTransitions>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ActiveWorkspaceContext.Provider
            value={{ activeWorkspace, setActiveWorkspace: () => undefined }}
          >
            <WorkspacePresenceContext.Provider value={{ hasWorkspaces: true }}>
              <WorkspaceStateContext.Provider value={createWorkspaceState()}>
                <WorkspaceBranchStateContext.Provider value={createWorkspaceBranchState()}>
                  <RuntimeDefinitionsContext.Provider
                    value={{
                      runtimeDefinitions: [],
                      availableRuntimeDefinitions: [],
                      agentRuntimes: settingsSnapshot.agentRuntimes,
                      isLoadingRuntimeDefinitions: options.isLoadingRuntimeDefinitions ?? false,
                      runtimeDefinitionsError: options.runtimeDefinitionsError ?? null,
                      refreshRuntimeDefinitions: async () => [],
                      loadRepoRuntimeCatalog: async () => {
                        throw new Error("loadRepoRuntimeCatalog is not used in this test");
                      },
                      loadRepoRuntimeSlashCommands: async () => {
                        throw new Error("loadRepoRuntimeSlashCommands is not used in this test");
                      },
                      loadRepoRuntimeSkills: async () => {
                        throw new Error("loadRepoRuntimeSkills is not used in this test");
                      },
                      loadRepoRuntimeSubagents: async () => {
                        throw new Error("loadRepoRuntimeSubagents is not used in this test");
                      },
                      loadRepoRuntimeFileSearch: async () => {
                        throw new Error("loadRepoRuntimeFileSearch is not used in this test");
                      },
                    }}
                  >
                    <RepoRuntimeHealthContext.Provider
                      value={{
                        runtimeHealthByRuntime: {},
                        isLoadingRepoRuntimeHealth: false,
                        refreshRepoRuntimeHealth: async () => ({}),
                      }}
                    >
                      <ChecksStateContext.Provider value={createChecksState()}>
                        <TasksStateContext.Provider value={createTasksState()}>
                          <AgentSessionsContext.Provider value={createAgentSessionsStore("/repo")}>
                            <Routes>
                              <Route element={<AppShell />}>
                                <Route path="/kanban" element={<main>Kanban</main>} />
                              </Route>
                            </Routes>
                          </AgentSessionsContext.Provider>
                        </TasksStateContext.Provider>
                      </ChecksStateContext.Provider>
                    </RepoRuntimeHealthContext.Provider>
                  </RuntimeDefinitionsContext.Provider>
                </WorkspaceBranchStateContext.Provider>
              </WorkspaceStateContext.Provider>
            </WorkspacePresenceContext.Provider>
          </ActiveWorkspaceContext.Provider>
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

describe("AppShell", () => {
  beforeEach(() => {
    installLocalStorage(new MemoryStorage());
  });

  afterEach(() => {
    cleanup();
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
      return;
    }

    Reflect.deleteProperty(globalThis, "localStorage");
  });

  test("opens the sidebar by default when no preference is stored", () => {
    renderAppShellForTest();

    expect(screen.getByRole("button", { name: "Hide sidebar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show sidebar" })).toBeNull();
    expect(globalThis.localStorage.getItem(LEFT_SIDEBAR_STORAGE_KEY)).toBeNull();
  });

  test("keeps the settings trigger available when the sidebar is collapsed", async () => {
    renderAppShellForTest();

    await waitFor(() => expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));

    const collapsedSettingsButton = screen.getByRole("button", { name: "Settings" });
    expect(collapsedSettingsButton.getAttribute("aria-label")).toBe("Settings");
    expect(collapsedSettingsButton.getAttribute("title")).toBe("Settings");
    expect(collapsedSettingsButton.textContent?.trim()).toBe("");
    expect(collapsedSettingsButton.className).toContain("size-8");
    expect(collapsedSettingsButton.className).not.toContain("px-3");
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
    expect(diagnosticsButton.className).toContain("size-8");
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

    try {
      renderAppShellForTest();

      expect(screen.getByRole("button", { name: "Hide sidebar" })).toBeTruthy();
      expect(getItem).toHaveBeenCalledWith(LEFT_SIDEBAR_STORAGE_KEY);
      expect(consoleError).toHaveBeenCalled();
    } finally {
      console.error = originalConsoleError;
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
