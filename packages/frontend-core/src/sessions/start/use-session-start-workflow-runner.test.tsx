import "../../test-support/dom-environment";
import { expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import type { TaskWorktreeSummary, WorkflowLaunchResult } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import type { ClientConnection } from "../../connection/client-connection";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { createAgentSessionsStore } from "../agent-sessions-store";
import { AgentOperationsContext, AgentSessionsContext } from "../session-contexts";
import { taskWorktreeQueryOptions } from "../../queries/build-runtime";
import { terminalQueryKeys } from "../../queries/terminals";
import type { AgentOperationsContextValue } from "../../types/session-slices";
import { useSessionStartWorkflowRunner } from "./use-session-start-workflow-runner";
import type { SessionStartWorkflowResult } from "./session-start-workflow";
import { createAgentOperationsFixture } from "../../test-support/agent-operations-fixture";

const createConnection = (client: Partial<HostClient>): ClientConnection =>
  createTestClientConnection({
    client,
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  });

const createWrapper = (
  connection: ClientConnection,
  operations: AgentOperationsContextValue = createAgentOperationsFixture(),
) => {
  const store = createAgentSessionsStore("/repo");
  const wrapper = ({ children }: PropsWithChildren) => (
    <ClientConnectionProvider connection={connection}>
      <AgentSessionsContext value={store}>
        <AgentOperationsContext value={operations}>{children}</AgentOperationsContext>
      </AgentSessionsContext>
    </ClientConnectionProvider>
  );
  return wrapper;
};

const workspace = { workspaceId: "workspace", repoPath: "/repo" };

test.each(["completed", "failed", "disconnected"] as const)(
  "manual launch refreshes the requested worktree and task terminals: %s",
  async (result) => {
    let worktree: TaskWorktreeSummary | null = null;
    const agentSessionWorkflowLaunch: HostClient["agentSessionWorkflowLaunch"] = mock(
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
    const connection = createConnection({
      taskWorktreeGet: mock(async () => worktree),
      agentSessionWorkflowLaunch,
    });
    const { queryClient } = connection;
    const wrapper = createWrapper(connection);
    const reads = [null, "old-version"].map((taskVersion) =>
      taskWorktreeQueryOptions({ repoPath: "/repo", taskId: "task", taskVersion }),
    );
    const otherReads = [
      { repoPath: "/repo", taskId: "other-task" },
      { repoPath: "/other-repo", taskId: "task" },
    ].map((input) => taskWorktreeQueryOptions(input));
    const terminalKey = terminalQueryKeys.task({ repoPath: "/repo", taskId: "task" });
    const otherTerminalKey = terminalQueryKeys.task({ repoPath: "/repo", taskId: "other-task" });
    for (const key of [terminalKey, otherTerminalKey])
      queryClient.setQueryData(key, { hostInstanceId: "host-1", terminals: [] });
    let unmount: (() => void) | undefined;
    try {
      for (const read of [...reads, ...otherReads])
        expect(await queryClient.fetchQuery(read)).toBeNull();
      const view = renderHook(() => useSessionStartWorkflowRunner(workspace), {
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
    }
  },
);

test("retries an unsent first message through the agent operations send path", async () => {
  const agentSessionWorkflowLaunch: HostClient["agentSessionWorkflowLaunch"] = mock(
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
  const connection = createConnection({ agentSessionWorkflowLaunch });
  const view = renderHook(() => useSessionStartWorkflowRunner(workspace), {
    wrapper: createWrapper(connection, createAgentOperationsFixture({ sendAgentMessage })),
  });
  try {
    let retry: SessionStartWorkflowResult["retryPostStartMessage"];
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
    connection.queryClient.clear();
  }
});
