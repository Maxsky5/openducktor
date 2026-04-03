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
  findActiveWorkspace,
} from "./app-state-context-values";

const workspace = (path: string, isActive = false): WorkspaceRecord => ({
  path,
  isActive,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: "/tmp/default-worktrees",
  effectiveWorktreeBasePath: "/tmp/default-worktrees",
});

describe("app-state-context-values", () => {
  test("finds active workspace by path", () => {
    const workspaces = [workspace("/repo-a"), workspace("/repo-b", true)];
    expect(findActiveWorkspace(workspaces, "/repo-b")?.path).toBe("/repo-b");
    expect(findActiveWorkspace(workspaces, "/missing")).toBeNull();
    expect(findActiveWorkspace(workspaces, null)).toBeNull();
  });

  test("builds workspace context and resolves active workspace when omitted", () => {
    const value = buildWorkspaceStateValue({
      isSwitchingWorkspace: false,
      isLoadingBranches: false,
      isSwitchingBranch: false,
      branchSyncDegraded: false,
      workspaces: [workspace("/repo-a"), workspace("/repo-b")],
      activeRepo: "/repo-a",
      branches: [],
      activeBranch: null,
      addWorkspace: async () => {},
      selectWorkspace: async () => {},
      refreshBranches: async () => {},
      switchBranch: async () => {},
      loadRepoSettings: async () => ({
        defaultRuntimeKind: "opencode" as const,
        worktreeBasePath: "",
        branchPrefix: "odt",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        trustedHooks: false,
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
        repos: {},
        globalPromptOverrides: {},
      }),
      detectGithubRepository: async () => null,
      saveGlobalGitConfig: async () => {},
      saveSettingsSnapshot: async () => {},
    });

    expect(value.activeWorkspace?.path).toBe("/repo-a");
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
      runs: [],
      refreshTasks: async () => {},
      syncPullRequests: async (_taskId: string) => {},
      linkMergedPullRequest: async () => {},
      cancelLinkMergedPullRequest: () => {},
      unlinkPullRequest: async (_taskId: string) => {},
      createTask: async () => {},
      updateTask: async () => {},
      deleteTask: async () => {},
      resetTaskImplementation: async () => {},
      transitionTask: async () => {},
      deferTask: async () => {},
      resumeDeferredTask: async () => {},
      humanApproveTask: async () => {},
      humanRequestChangesTask: async () => {},
    };
    const delegationValue: DelegationStateContextValue = {
      events: [],
      delegateTask: async () => {},
      delegateRespond: async () => {},
      delegateStop: async () => {},
      delegateCleanup: async () => {},
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
      removeAgentSessions: () => {},
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
