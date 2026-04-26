import { describe, expect, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import type {
  AgentStateContextValue,
  ChecksStateContextValue,
  DelegationStateContextValue,
  SpecStateContextValue,
  TasksStateContextValue,
} from "@/types/state-slices";
import {
  buildAgentStateValue,
  buildChecksStateValue,
  buildDelegationStateValue,
  buildSpecStateValue,
  buildTasksStateValue,
  buildWorkspaceStateValue,
} from "./app-state-context-values";

const workspace = (path: string, isActive = false): WorkspaceRecord => ({
  workspaceId: path.split("/").filter(Boolean).at(-1) ?? "repo",
  workspaceName: path.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath: path,
  isActive,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: "/tmp/default-worktrees",
  effectiveWorktreeBasePath: "/tmp/default-worktrees",
});

describe("app-state-context-values", () => {
  test("builds workspace context with the provided active workspace", () => {
    const activeWorkspace = workspace("/repo-a", true);
    const value = buildWorkspaceStateValue({
      isSwitchingWorkspace: false,
      isLoadingBranches: false,
      isSwitchingBranch: false,
      branchSyncDegraded: false,
      workspaces: [workspace("/repo-a"), workspace("/repo-b")],
      activeWorkspace,
      branches: [],
      activeBranch: null,
      addWorkspace: async () => {},
      selectWorkspace: async () => {},
      reorderWorkspaces: async () => {},
      refreshBranches: async () => {},
      switchBranch: async () => {},
      loadRepoSettings: async () => ({
        defaultRuntimeKind: "opencode" as const,
        worktreeBasePath: "",
        branchPrefix: "odt",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        preStartHooks: [],
        postCompleteHooks: [],
        devServers: [],
        worktreeFileCopies: [],
        agentDefaults: { spec: null, planner: null, build: null, qa: null },
      }),
      saveRepoSettings: async () => {},
      loadSettingsSnapshot: async () => ({
        theme: "light" as const,
        git: {
          defaultMergeMethod: "merge_commit",
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
      }),
      detectGithubRepository: async () => null,
      saveGlobalGitConfig: async () => {},
      saveSettingsSnapshot: async () => {},
    });

    expect(value.activeWorkspace).toEqual(activeWorkspace);
  });

  test("returns identity for other context builders", () => {
    const checksValue: ChecksStateContextValue = {
      runtimeCheck: null,
      beadsCheck: null,
      runtimeCheckFailureKind: null,
      beadsCheckFailureKind: null,
      runtimeHealthByRuntime: {},
      isLoadingChecks: false,
      refreshChecks: async () => {},
    };
    const tasksValue: TasksStateContextValue = {
      isForegroundLoadingTasks: false,
      isRefreshingTasksInBackground: false,
      isLoadingTasks: false,
      detectingPullRequestTaskId: null,
      linkingMergedPullRequestTaskId: null,
      unlinkingPullRequestTaskId: null,
      pendingMergedPullRequest: null,
      tasks: [],
      refreshTasks: async () => {},
      syncPullRequests: async (_taskId: string) => {},
      linkMergedPullRequest: async () => {},
      cancelLinkMergedPullRequest: () => {},
      unlinkPullRequest: async (_taskId: string) => {},
      createTask: async () => {},
      updateTask: async () => {},
      setTaskTargetBranch: async () => {},
      deleteTask: async () => {},
      resetTaskImplementation: async () => {},
      resetTask: async () => {},
      transitionTask: async () => {},
      deferTask: async () => {},
      resumeDeferredTask: async () => {},
      humanApproveTask: async () => {},
      humanRequestChangesTask: async () => {},
    };
    const delegationValue: DelegationStateContextValue = {
      delegateTask: async () => {},
    };
    const specValue: SpecStateContextValue = {
      loadSpec: async () => "",
      loadSpecDocument: async () => ({ markdown: "", updatedAt: null }),
      loadPlanDocument: async () => ({ markdown: "", updatedAt: null }),
      loadQaReportDocument: async () => ({ markdown: "", updatedAt: null }),
      saveSpec: async () => ({ updatedAt: "" }),
      saveSpecDocument: async () => ({ updatedAt: "" }),
      savePlanDocument: async () => ({ updatedAt: "" }),
    };
    const agentValue: AgentStateContextValue = {
      sessions: [],
      bootstrapTaskSessions: async () => {},
      hydrateRequestedTaskSessionHistory: async () => {},
      ensureSessionReadyForView: async () => false,
      reconcileLiveTaskSessions: async () => {},
      loadAgentSessions: async () => {},
      readSessionModelCatalog: async () => ({
        providers: [],
        models: [],
        variants: [],
        profiles: [],
        defaultModelsByProvider: {},
      }),
      readSessionSlashCommands: async () => ({ commands: [] }),
      readSessionFileSearch: async () => [],
      readSessionTodos: async () => [],
      removeAgentSession: async () => {},
      removeAgentSessions: async () => {},
      startAgentSession: async () => "session",
      sendAgentMessage: async () => {},
      stopAgentSession: async () => {},
      updateAgentSessionModel: () => {},
      replyAgentPermission: async () => {},
      answerAgentQuestion: async () => {},
    };

    expect(buildChecksStateValue(checksValue)).toBe(checksValue);
    expect(buildTasksStateValue(tasksValue)).toBe(tasksValue);
    expect(buildDelegationStateValue(delegationValue)).toBe(delegationValue);
    expect(buildSpecStateValue(specValue)).toBe(specValue);
    expect(buildAgentStateValue(agentValue)).toBe(agentValue);
  });
});
