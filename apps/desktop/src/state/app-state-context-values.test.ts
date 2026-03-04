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
        worktreeBasePath: "",
        branchPrefix: "odt",
        defaultTargetBranch: "main",
        trustedHooks: false,
        preStartHooks: [],
        postCompleteHooks: [],
        worktreeFileCopies: [],
        agentDefaults: { spec: null, planner: null, build: null, qa: null },
      }),
      saveRepoSettings: async () => {},
      loadSettingsSnapshot: async () => ({
        repos: {},
        globalPromptOverrides: {},
      }),
      saveSettingsSnapshot: async () => {},
    });

    expect(value.activeWorkspace?.path).toBe("/repo-a");
  });

  test("returns identity for other context builders", () => {
    const checksValue: ChecksStateContextValue = {
      runtimeCheck: null,
      beadsCheck: null,
      opencodeHealth: null,
      isLoadingChecks: false,
      refreshChecks: async () => {},
    };
    const tasksValue: TasksStateContextValue = {
      isLoadingTasks: false,
      tasks: [],
      runs: [],
      refreshTasks: async () => {},
      createTask: async () => {},
      updateTask: async () => {},
      deleteTask: async () => {},
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
      loadAgentSessions: async () => {},
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
