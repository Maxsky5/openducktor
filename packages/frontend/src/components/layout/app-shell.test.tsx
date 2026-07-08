import { describe, expect, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const renderAppShellForTest = (): ReturnType<typeof render> => {
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
                      isLoadingRuntimeDefinitions: false,
                      runtimeDefinitionsError: null,
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
});
