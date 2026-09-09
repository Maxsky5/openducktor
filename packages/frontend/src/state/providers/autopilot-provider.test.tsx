import { describe, expect, spyOn, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
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

const createWorkspaceState = (): WorkspaceStateContextValue => ({
  isSwitchingWorkspace: false,
  isLoadingBranches: false,
  isSwitchingBranch: false,
  branchSyncDegraded: false,
  workspaces: [],
  activeWorkspace: {
    workspaceId: "workspace-a",
    workspaceName: "Workspace A",
    repoPath: "/repo",
    isActive: true,
    hasConfig: true,
    configuredWorktreeBasePath: "/worktrees/repo",
    defaultWorktreeBasePath: "/worktrees/repo",
    effectiveWorktreeBasePath: "/worktrees/repo",
  },
  branches: [],
  activeBranch: null,
  addWorkspace: async () => {},
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
  saveSettingsSnapshot: async () => {},
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
  openSystemSettings: async () => {},
  previewCue: async () => {},
  testInApp: async () => {},
  testOs: async () => ({ status: "shown" }),
  registerNavigator: () => () => {},
  sessionStartNotifications: {
    publishSessionStarted: () => {},
    publishSessionError: async () => true,
    reportFailure: () => {},
  },
  taskStreamSink: {
    onChange: async () => {},
    onSnapshot: async () => {},
    onFailure: () => {},
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
  startAgentSession: async () => {
    throw new Error("Unexpected session start.");
  },
  sendAgentMessage: async () => {},
  stopAgentSession: async () => {},
  updateAgentSessionModel: () => {},
  replyAgentApproval: async () => {},
  answerAgentQuestion: async () => {},
};

describe("AutopilotProvider", () => {
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
