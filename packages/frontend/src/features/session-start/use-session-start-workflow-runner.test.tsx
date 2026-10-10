import { expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import type { TaskWorktreeSummary, WorkflowLaunchResult } from "@openducktor/contracts";
import {
  configureShellBridge,
  createUnavailableShellBridge,
  getShellBridge,
} from "@/lib/shell-bridge";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import {
  AgentOperationsContext,
  AgentSessionsContext,
  WorkspaceStateContext,
} from "@/state/app-state-contexts";
import {
  NotificationContext,
  type NotificationContextValue,
} from "@/state/notifications/notification-context";
import { taskWorktreeQueryOptions } from "@/state/queries/build-runtime";
import { terminalQueryKeys } from "@/state/queries/terminals";
import {
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import { useSessionStartWorkflowRunner } from "./use-session-start-workflow-runner";

const unexpected = (name: string) => async (): Promise<never> => {
  throw new Error(`Unexpected ${name}`);
};
const createOperations = (
  sendAgentMessage: AgentOperationsContextValue["sendAgentMessage"],
): AgentOperationsContextValue => ({
  describeGeneratedImages: unexpected("describeGeneratedImages"),
  beginGeneratedImageBatch: unexpected("beginGeneratedImageBatch"),
  releaseGeneratedImageBatch: unexpected("releaseGeneratedImageBatch"),
  readGeneratedImage: unexpected("readGeneratedImage"),
  readSessionTodos: unexpected("readSessionTodos"),
  readSessionHistory: unexpected("readSessionHistory"),
  loadAgentSessionHistory: unexpected("loadAgentSessionHistory"),
  loadAgentSessionContext: unexpected("loadAgentSessionContext"),
  sendAgentMessage,
  stopAgentSession: unexpected("stopAgentSession"),
  continueInterruptedTurn: unexpected("continueInterruptedTurn"),
  updateAgentSessionModel: unexpected("updateAgentSessionModel"),
  replyAgentApproval: unexpected("replyAgentApproval"),
  answerAgentQuestion: unexpected("answerAgentQuestion"),
});

const createWrapper = (
  queryClient: QueryClient,
  sendAgentMessage: AgentOperationsContextValue["sendAgentMessage"],
) => {
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
      markInAppFeedbackHandled: () => {},
      reportFailure: () => {},
    },
  };
  const store = createAgentSessionsStore("/repo");
  const operations = createOperations(sendAgentMessage);
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <WorkspaceStateContext value={workspace}>
        <AgentSessionsContext value={store}>
          <AgentOperationsContext value={operations}>
            <NotificationContext value={notifications}>{children}</NotificationContext>
          </AgentOperationsContext>
        </AgentSessionsContext>
      </WorkspaceStateContext>
    </QueryClientProvider>
  );
  return wrapper;
};

test.each(["completed", "failed", "disconnected"] as const)(
  "manual launch refreshes the requested worktree and task terminals: %s",
  async (result) => {
    const originalBridge = getShellBridge();
    const bridge = createUnavailableShellBridge();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let worktree: TaskWorktreeSummary | null = null;
    bridge.client.taskWorktreeGet = mock(async () => worktree);
    bridge.client.agentSessionWorkflowLaunch = mock(
      async (request): Promise<WorkflowLaunchResult> => {
        worktree = { workingDirectory: "/repo/task-worktree" };
        if (result === "disconnected") throw new Error("Connection closed after worktree creation");
        const base: WorkflowLaunchResult = {
          workspaceId: request.workspaceId,
          repoPath: request.repoPath,
          taskId: request.taskId,
          role: "build",
          status: result,
          startMode: "fresh",
        };
        if (result === "failed")
          return {
            ...base,
            failure: { message: "Start failed after worktree creation", cleanupErrors: [] },
          };
        return {
          ...base,
          session: {
            externalSessionId: "native",
            runtimeKind: "codex",
            workingDirectory: "/repo/task-worktree",
            startedAt: "2026-10-08T00:00:00Z",
            status: "idle",
          },
        };
      },
    );
    const wrapper = createWrapper(queryClient, unexpected("sendAgentMessage"));
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
    const terminalKey = terminalQueryKeys.task({ repoPath: "/repo", taskId: "task" });
    const otherTerminalKey = terminalQueryKeys.task({ repoPath: "/repo", taskId: "other-task" });
    for (const key of [terminalKey, otherTerminalKey])
      queryClient.setQueryData(key, { hostInstanceId: "host-1", terminals: [] });
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
      expect(queryClient.getQueryState(terminalKey)?.isInvalidated).toBe(result !== "disconnected");
      expect(queryClient.getQueryState(otherTerminalKey)?.isInvalidated).toBe(false);
    } finally {
      unmount?.();
      queryClient.clear();
      configureShellBridge(originalBridge);
    }
  },
);

test("retries an unsent first message through the agent operations send path", async () => {
  const originalBridge = getShellBridge();
  const bridge = createUnavailableShellBridge();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  bridge.client.agentSessionWorkflowLaunch = mock(
    async (request): Promise<WorkflowLaunchResult> => ({
      workspaceId: request.workspaceId,
      repoPath: request.repoPath,
      taskId: request.taskId,
      role: "build",
      status: "failed",
      startMode: "fresh",
      session: {
        externalSessionId: "native",
        runtimeKind: "codex",
        workingDirectory: "/repo/task-worktree",
        startedAt: "2026-10-08T00:00:00Z",
        status: "idle",
      },
      unsentInstruction: [{ kind: "text", text: "Continue" }],
      failure: { message: "Runtime rejected the message", cleanupErrors: [] },
    }),
  );
  const sendAgentMessage = mock(
    async (..._args: Parameters<AgentOperationsContextValue["sendAgentMessage"]>) => null,
  );
  configureShellBridge(bridge);
  const view = renderHook(() => useSessionStartWorkflowRunner({ workspaceId: "workspace" }), {
    wrapper: createWrapper(queryClient, sendAgentMessage),
  });
  try {
    let retry: (() => Promise<void>) | undefined;
    await act(async () => {
      const started = await view.result.current({
        task: null,
        request: {
          taskId: "task",
          role: "build",
          launchActionId: "build_implementation_start",
          postStartAction: "send_message",
          message: "Continue",
        },
        decision: {
          startMode: "fresh",
          selectedModel: { runtimeKind: "codex", providerId: "provider", modelId: "model" },
        },
      });
      expect(started.postStartActionError?.message).toBe("Runtime rejected the message");
      retry = started.retryPostStartMessage;
    });
    expect(sendAgentMessage).not.toHaveBeenCalled();
    await act(async () => {
      await retry?.();
    });
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(sendAgentMessage.mock.calls[0]?.[0]).toMatchObject({ externalSessionId: "native" });
    expect(sendAgentMessage.mock.calls[0]?.[1]).toEqual([{ kind: "text", text: "Continue" }]);
  } finally {
    view.unmount();
    queryClient.clear();
    configureShellBridge(originalBridge);
  }
});
