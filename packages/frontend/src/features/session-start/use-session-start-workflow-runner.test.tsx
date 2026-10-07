import { expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import type { TaskWorktreeSummary, WorkflowLaunchSnapshot } from "@openducktor/contracts";
import {
  configureShellBridge,
  createUnavailableShellBridge,
  getShellBridge,
} from "@/lib/shell-bridge";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { AgentSessionsContext, WorkspaceStateContext } from "@/state/app-state-contexts";
import {
  NotificationContext,
  type NotificationContextValue,
} from "@/state/notifications/notification-context";
import { taskWorktreeQueryOptions } from "@/state/queries/build-runtime";
import {
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import { useSessionStartWorkflowRunner } from "./use-session-start-workflow-runner";

test.each(["completed", "failed", "disconnected"] as const)(
  "manual launch refreshes the requested worktree after it is created: %s",
  async (result) => {
    const originalBridge = getShellBridge();
    const bridge = createUnavailableShellBridge();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let worktree: TaskWorktreeSummary | null = null;
    bridge.client.taskWorktreeGet = mock(async () => worktree);
    bridge.client.agentSessionWorkflowLaunch = mock(
      async (request): Promise<WorkflowLaunchSnapshot> => {
        worktree = { workingDirectory: "/repo/task-worktree" };
        if (result === "disconnected") throw new Error("Connection closed after worktree creation");
        return {
          launchAttemptId: request.launchAttemptId,
          workspaceId: request.workspaceId,
          repoPath: request.repoPath,
          taskId: request.taskId,
          role: "build",
          phase: result,
          acceptance: "not_submitted",
          ownershipSaved: result === "completed",
          completedPreStartActions: [],
          ...(result === "completed"
            ? {
                session: {
                  externalSessionId: "native",
                  runtimeKind: "codex",
                  workingDirectory: "/repo/task-worktree",
                  startedAt: "2026-10-08T00:00:00Z",
                  status: "idle",
                } as const,
              }
            : {
                failure: {
                  message: "Start failed after worktree creation",
                  stage: "session",
                  cleanupErrors: [],
                } as const,
              }),
        };
      },
    );
    bridge.client.agentSessionWorkflowLaunchRead = mock(async () => []);
    const workspace = createWorkspaceStateFixture({
      activeWorkspace: createWorkspaceRecordFixture({
        workspaceId: "workspace",
        repoPath: "/repo",
      }),
    });
    const notifications: NotificationContextValue = {
      deliveryFailure: null,
      getCapability: async () => {
        throw new Error("Unexpected capability read");
      },
      requestPermission: async () => {
        throw new Error("Unexpected permission request");
      },
      openSystemSettings: async () => {},
      previewCue: async () => {},
      testInApp: async () => {},
      testOs: async () => {
        throw new Error("Unexpected OS test");
      },
      registerNavigator: () => () => {},
      sessionStartNotifications: {
        publishSessionStarted: () => {},
        publishSessionError: async () => false,
        reportFailure: () => {},
      },
    };
    const store = createAgentSessionsStore("/repo");
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>
        <WorkspaceStateContext value={workspace}>
          <AgentSessionsContext value={store}>
            <NotificationContext value={notifications}>{children}</NotificationContext>
          </AgentSessionsContext>
        </WorkspaceStateContext>
      </QueryClientProvider>
    );
    const reads = [null, "old-version"].map((taskVersion) =>
      taskWorktreeQueryOptions({
        repoPath: "/repo",
        taskId: "task",
        taskVersion,
        hostClient: bridge.client,
      }),
    );
    const otherReads = [
      { repoPath: "/repo", taskId: "other-task" },
      { repoPath: "/other-repo", taskId: "task" },
    ].map((input) => taskWorktreeQueryOptions({ ...input, hostClient: bridge.client }));
    configureShellBridge(bridge);
    let unmount: (() => void) | undefined;
    try {
      for (const read of [...reads, ...otherReads])
        expect(await queryClient.fetchQuery(read)).toBeNull();
      const view = renderHook(() => useSessionStartWorkflowRunner({ workspaceId: "workspace" }), {
        wrapper,
      });
      unmount = view.unmount;
      let error: unknown;
      await act(async () => {
        try {
          await view.result.current({
            task: null,
            request: {
              taskId: "task",
              role: "build",
              launchActionId: "build_implementation_start",
              postStartAction: "none",
            },
            decision: {
              startMode: "fresh",
              selectedModel: { runtimeKind: "codex", providerId: "provider", modelId: "model" },
            },
          });
        } catch (cause) {
          error = cause;
        }
      });
      if (result === "completed") expect(error).toBeUndefined();
      else expect(error).toBeInstanceOf(Error);
      for (const read of reads)
        expect(await queryClient.fetchQuery(read)).toEqual({
          workingDirectory: "/repo/task-worktree",
        });
      for (const read of otherReads) expect(await queryClient.fetchQuery(read)).toBeNull();
    } finally {
      unmount?.();
      queryClient.clear();
      configureShellBridge(originalBridge);
    }
  },
);
