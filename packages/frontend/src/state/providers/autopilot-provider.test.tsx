import { describe, expect, mock, spyOn, test } from "bun:test";
import type { TaskCard, TaskWorktreeSummary, WorkflowLaunchResult } from "@openducktor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import * as autopilotActions from "@/features/autopilot/autopilot-actions";
import { SessionStartWorkflowError } from "@/features/session-start/session-start-orchestration";
import { createRuntimeDefinitionsContextValue } from "@/pages/agents/agent-studio-test-utils";
import {
  AgentOperationsContext,
  RuntimeDefinitionsContext,
  TaskSnapshotContext,
  WorkspaceStateContext,
} from "@/state/app-state-contexts";
import {
  NotificationContext,
  type NotificationContextValue,
} from "@/state/notifications/notification-context";
import { workspaceQueryKeys } from "@/state/queries/workspace";
import {
  createSettingsSnapshotFixture,
  createTaskCardFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentOperationsContextValue, WorkspaceStateContextValue } from "@/types/state-slices";
import { AutopilotProvider } from "./autopilot-provider";
import {
  configureShellBridge,
  createUnavailableShellBridge,
  getShellBridge,
} from "@/lib/shell-bridge";
import { taskWorktreeQueryOptions } from "@/state/queries/build-runtime";

const createWorkspaceState = (): WorkspaceStateContextValue => ({
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
  workspaces: [],
  activeWorkspace: {
    workspaceId: "workspace-a",
    workspaceName: "Workspace A",
    abbreviation: null,
    tileColor: null,
    repoPath: "/repo",
    isActive: true,
    hasConfig: true,
    configuredWorktreeBasePath: "/worktrees/repo",
    defaultWorktreeBasePath: "/worktrees/repo",
    effectiveWorktreeBasePath: "/worktrees/repo",
  },
  branches: [],
  activeBranch: null,
  commitWorkspaceProviderSetup: async () => {
    throw new Error("Not used");
  },
  addWorkspace: async () => {
    throw new Error("Not used");
  },
  saveWorkspaceModelDefaults: async () => {
    throw new Error("Not used");
  },
  selectWorkspace: async () => {},
  reorderWorkspaces: async () => {},
  refreshBranches: async () => {},
  switchBranch: async () => {},
  loadRepoSettings: async () => {
    throw new Error("Not used by this test.");
  },
  saveRepoSettings: async () => {},
  loadSettingsSnapshot: async () => {
    throw new Error("Not used by this test.");
  },
  detectGithubRepository: async () => null,
  saveGlobalGitConfig: async () => {},
  previewSettingsSnapshotRuntime: async () => ({ impact: null }),
  saveSettingsSnapshot: async () => ({
    type: "saved" as const,
    workspaces: [],
    runtimeApplications: [],
    refreshError: null,
  }),
  saveAgentModelFavorites: async () => {
    throw new Error("Not used by this test.");
  },
});

const createNotificationContext = (
  overrides: Partial<NotificationContextValue> = {},
): NotificationContextValue => ({
  deliveryFailure: null,
  getCapability: async () => ({
    platform: "browser",
    supported: true,
    permission: "prompt",
    canGuaranteeSilent: true,
    canOpenSystemSettings: false,
  }),
  requestPermission: async () => {
    throw new Error("Unexpected notification permission request.");
  },
  openSystemSettings: async () => {},
  previewCue: async () => {},
  testInApp: async () => {},
  testOs: async () => ({ status: "shown" }),
  registerNavigator: () => () => {},
  sessionStartNotifications: {
    publishSessionStarted: () => {},
    publishSessionError: async () => true,
    markInAppFeedbackHandled: () => {},
    reportFailure: () => {},
  },
  ...overrides,
});

const agentOperations: AgentOperationsContextValue = {
  readSessionTodos: async () => [],
  readSessionHistory: async () => [],
  describeGeneratedImages: async () => {
    throw new Error("Unexpected image metadata read");
  },
  beginGeneratedImageBatch: async () => {
    throw new Error("Unexpected beginGeneratedImageBatch");
  },
  releaseGeneratedImageBatch: async () => {
    throw new Error("Unexpected releaseGeneratedImageBatch");
  },
  readGeneratedImage: async () => {
    throw new Error("Unexpected generated image read.");
  },
  loadAgentSessionHistory: async () => null,
  loadAgentSessionContext: async () => {},
  sendAgentMessage: async () => null,
  stopAgentSession: async () => {},
  continueInterruptedTurn: async () => undefined,
  updateAgentSessionModel: async () => {},
  replyAgentApproval: async () => {},
  answerAgentQuestion: async () => {},
};

describe("AutopilotProvider", () => {
  test.each(["completed", "failed"] as const)(
    "automatic launch refreshes the requested worktree after creation: %s",
    async (phase) => {
      const originalBridge = getShellBridge();
      const bridge = createUnavailableShellBridge();
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      let worktree: TaskWorktreeSummary | null = null;
      bridge.client.taskWorktreeGet = mock(async () => worktree);
      bridge.client.agentSessionWorkflowLaunch = mock(
        async (request): Promise<WorkflowLaunchResult> => {
          worktree = { workingDirectory: "/worktrees/task-1" };
          const base: WorkflowLaunchResult = {
            workspaceId: request.workspaceId,
            repoPath: request.repoPath,
            taskId: request.taskId,
            role: "build",
            status: phase,
            startMode: "fresh",
          };
          if (phase === "failed")
            return {
              ...base,
              failure: { message: "Start failed after worktree creation", cleanupErrors: [] },
            };
          return {
            ...base,
            session: {
              externalSessionId: "native",
              runtimeKind: "codex",
              workingDirectory: "/worktrees/task-1",
              startedAt: "2026-10-08T00:00:00Z",
              status: "idle",
            },
          };
        },
      );
      const reads = [null, "old-version"].map((taskVersion) =>
        taskWorktreeQueryOptions({
          repoPath: "/repo",
          taskId: "task-1",
          taskVersion,
          hostClient: bridge.client,
        }),
      );
      const otherReads = [
        { repoPath: "/repo", taskId: "other-task" },
        { repoPath: "/other-repo", taskId: "task-1" },
      ].map((input) => taskWorktreeQueryOptions({ ...input, hostClient: bridge.client }));
      queryClient.setQueryData(
        workspaceQueryKeys.settingsSnapshot(),
        createSettingsSnapshotFixture({
          autopilot: {
            alwaysStartQaReviewsFresh: false,
            rules: [{ eventId: "taskProgressedToReadyForDev", actionIds: ["startBuilder"] }],
          },
        }),
      );
      const workspace = createWorkspaceState();
      const notifications = createNotificationContext();
      const view = (task: TaskCard) => (
        <QueryClientProvider client={queryClient}>
          <WorkspaceStateContext value={workspace}>
            <TaskSnapshotContext value={{ tasks: [task], isLoadingTasks: false }}>
              <NotificationContext value={notifications}>
                <AutopilotProvider />
              </NotificationContext>
            </TaskSnapshotContext>
          </WorkspaceStateContext>
        </QueryClientProvider>
      );
      configureShellBridge(bridge);
      let unmount: (() => void) | undefined;
      try {
        for (const read of [...reads, ...otherReads])
          expect(await queryClient.fetchQuery(read)).toBeNull();
        const rendered = render(
          view(createTaskCardFixture({ id: "task-1", status: "spec_ready" })),
        );
        unmount = rendered.unmount;
        await act(async () => {
          rendered.rerender(view(createTaskCardFixture({ id: "task-1", status: "ready_for_dev" })));
        });
        await waitFor(() =>
          expect(queryClient.getQueryState(reads[0]!.queryKey)?.isInvalidated).toBe(true),
        );
        expect(bridge.client.agentSessionWorkflowLaunch).toHaveBeenCalledTimes(1);
        for (const read of reads)
          expect(await queryClient.fetchQuery(read)).toEqual({
            workingDirectory: "/worktrees/task-1",
          });
        for (const read of otherReads) expect(await queryClient.fetchQuery(read)).toBeNull();
      } finally {
        unmount?.();
        queryClient.clear();
        configureShellBridge(originalBridge);
      }
    },
  );

  test.each([false, true])(
    "shows kickoff failure only when in-app feedback was not handled (%s)",
    async (feedbackHandled) => {
      const action = spyOn(autopilotActions, "executeAutopilotAction").mockResolvedValue({
        kind: "started",
        message: "Started",
        postStartActionError: new SessionStartWorkflowError(
          new Error("Kickoff failed"),
          feedbackHandled,
        ),
      });
      const errorToast = spyOn(toast, "error").mockReturnValue("error-toast");
      const queryClient = new QueryClient();
      queryClient.setQueryData(
        workspaceQueryKeys.settingsSnapshot(),
        createSettingsSnapshotFixture({
          autopilot: {
            alwaysStartQaReviewsFresh: false,
            rules: [{ eventId: "taskProgressedToSpecReady", actionIds: ["startPlanner"] }],
          },
        }),
      );
      const workspace = createWorkspaceState();
      const runtimeDefinitions = createRuntimeDefinitionsContextValue();
      const notifications = createNotificationContext();
      const view = (task: TaskCard) => (
        <QueryClientProvider client={queryClient}>
          <WorkspaceStateContext.Provider value={workspace}>
            <TaskSnapshotContext.Provider value={{ tasks: [task], isLoadingTasks: false }}>
              <RuntimeDefinitionsContext.Provider value={runtimeDefinitions}>
                <AgentOperationsContext.Provider value={agentOperations}>
                  <NotificationContext.Provider value={notifications}>
                    <AutopilotProvider />
                  </NotificationContext.Provider>
                </AgentOperationsContext.Provider>
              </RuntimeDefinitionsContext.Provider>
            </TaskSnapshotContext.Provider>
          </WorkspaceStateContext.Provider>
        </QueryClientProvider>
      );
      const rendered = render(view(createTaskCardFixture({ id: "task-1", status: "open" })));
      try {
        await act(async () => {
          rendered.rerender(view(createTaskCardFixture({ id: "task-1", status: "spec_ready" })));
        });
        expect(action).toHaveBeenCalledTimes(1);
        expect(errorToast).toHaveBeenCalledTimes(feedbackHandled ? 0 : 1);
        if (!feedbackHandled) {
          expect(errorToast).toHaveBeenCalledWith("Autopilot message failed for task-1.", {
            description: "Kickoff failed",
          });
        }
      } finally {
        rendered.unmount();
        queryClient.clear();
        action.mockRestore();
        errorToast.mockRestore();
      }
    },
  );
});
