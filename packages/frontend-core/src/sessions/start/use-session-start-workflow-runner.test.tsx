import "../../test-support/dom-environment";
import { expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import type {
  TaskWorktreeSummary,
  WorkflowLaunchResult,
  WorkflowLaunchRequest,
} from "@openducktor/contracts";
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
import { createAgentOperationsFixture } from "../../test-support/agent-operations-fixture";
import { createStartupLiveSourceFake } from "../../test-support/startup-live-source-fake";
import type { AgentMessageSendReceipt } from "../../types/agent-orchestrator";

const createConnection = (client: Partial<HostClient>): ClientConnection => {
  const connection = createTestClientConnection({
    client,
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  });
  createStartupLiveSourceFake(connection.queryClient);
  return connection;
};

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

test("a local launch guard leaves confirmed unsaved feedback without dispatch", async () => {
  const launch = mock(async (): Promise<WorkflowLaunchResult> => {
    throw new Error("Unexpected host dispatch");
  });
  const connection = createConnection({ agentSessionWorkflowLaunch: launch });
  const view = renderHook(() => useSessionStartWorkflowRunner(workspace), {
    wrapper: createWrapper(connection),
  });
  try {
    await act(async () => {
      try {
        await view.result.current({
          task: null,
          request: {
            taskId: "task",
            role: "build",
            launchActionId: "build_implementation_start",
            postStartAction: "none",
            assertBeforeLaunch: () => {
              throw new Error("The task changed before submission.");
            },
          },
          decision: {
            startMode: "fresh",
            selectedModel: { runtimeKind: "codex", providerId: "openai", modelId: "model" },
          },
        });
      } catch {
        /* The retained progress reports this rejected submission. */
      }
    });
    expect(launch).not.toHaveBeenCalled();
    const attempt = connection.startupAttempts.getSnapshot()[0];
    expect(attempt?.ownership.state).toBe("not_saved");
    expect(attempt?.status).toEqual({ phase: "failed", confirmation: "current" });
    expect(attempt?.error).toBe("The task changed before submission.");
  } finally {
    view.unmount();
    await connection.dispose();
  }
});

test.each([
  { outcome: "accepted", invalidatedAt: "none" },
  { outcome: "accepted", invalidatedAt: "retry" },
  { outcome: "queued", invalidatedAt: "none" },
  { outcome: "queued", invalidatedAt: "retry" },
  { outcome: "acknowledged", invalidatedAt: "none" },
  { outcome: "acknowledged", invalidatedAt: "retry" },
  { outcome: "accepted", invalidatedAt: "repair" },
] as const)(
  "repairs the saved workflow and retains $outcome retry with preparation invalidated at $invalidatedAt",
  async ({ outcome, invalidatedAt }) => {
    const requests: WorkflowLaunchRequest[] = [];
    const record = {
      externalSessionId: "saved",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/worktree",
      role: "build" as const,
      startedAt: "2026-10-26T00:00:00Z",
      selectedModel: null,
    };
    const native = { ...record, status: "idle" as const };
    const connection = createConnection({
      agentSessionWorkflowLaunch: async (request) => {
        requests.push(request);
        if (!request.startup) throw new Error("Missing startup context");
        const base = { ...workspace, taskId: "task", role: "build" as const, session: native };
        if (requests.length === 1)
          return {
            ...base,
            status: "failed",
            failure: { message: "Workflow update failed", cleanupErrors: [] },
            unsentInstruction: [{ kind: "text", text: "Continue" }],
            startupProgress: {
              ...workspace,
              context: request.startup,
              hostInstanceId: "host",
              revision: 1,
              scope: { kind: "task", taskId: "task", role: "build" },
              phase: "failed",
              steps: [],
              ownership: { state: "saved", target: { kind: "task", record } },
              instruction: { state: "not_sent" },
            },
          };
        const startupProgress = live.prepared({
          ...workspace,
          context: request.startup,
          scope: { kind: "task", taskId: "task", role: "build" },
          ownership: { state: "saved", target: { kind: "task", record, runtimeSession: native } },
        });
        if (invalidatedAt === "repair") live.remove(startupProgress.prepared!.ref);
        return { ...base, status: "completed", startupProgress };
      },
    });
    const live = createStartupLiveSourceFake(connection.queryClient);
    const sendAgentMessage = mock(
      async (
        recipient: Parameters<AgentOperationsContextValue["sendAgentMessage"]>[0],
      ): Promise<AgentMessageSendReceipt> => {
        if (invalidatedAt === "retry") live.remove({ ...recipient, repoPath: workspace.repoPath });
        if (outcome === "queued") return { outcome, recipient };
        if (outcome === "acknowledged")
          return {
            outcome,
            recipient,
            submissionId: "retry-submission",
            postAcceptanceFailure: "The transcript update failed after acceptance.",
          };
        return {
          outcome: "accepted" as const,
          recipient,
          acceptedMessage: { type: "command_accepted" as const, commandName: "Continue" },
          postAcceptanceFailure: null,
        };
      },
    );
    const view = renderHook(() => useSessionStartWorkflowRunner(workspace), {
      wrapper: createWrapper(connection, createAgentOperationsFixture({ sendAgentMessage })),
    });
    try {
      await act(async () => {
        await view.result.current({
          task: null,
          request: {
            taskId: "task",
            role: "build",
            launchActionId: "build_after_human_request_changes",
            postStartAction: "send_message",
            message: "Continue",
            beforeStartAction: { action: "human_request_changes", note: "Fix this" },
          },
          decision: {
            startMode: "fresh",
            selectedModel: { runtimeKind: "codex", providerId: "openai", modelId: "model" },
            targetBranch: { branch: "main" },
          },
        });
      });
      const id = connection.startupAttempts.getSnapshot()[0]!.id;
      expect(connection.startupAttempts.getAttempt(id)?.recoveryActions?.[0]?.kind).toBe("repair");
      await act(async () => {
        await connection.startupAttempts.getAttempt(id)?.recoveryActions?.[0]?.run();
      });
      expect(requests).toHaveLength(2);
      expect(requests[1]).toMatchObject({
        policy: {
          actionId: "build_after_human_request_changes",
          decision: { startMode: "reuse", sourceSession: { externalSessionId: "saved" } },
        },
        instruction: { kind: "none" },
      });
      expect(requests[1]).not.toHaveProperty("beforeStartAction");
      expect(requests[1]).not.toHaveProperty("targetBranch");
      expect(sendAgentMessage).not.toHaveBeenCalled();
      if (invalidatedAt === "repair") {
        const settled = connection.startupAttempts.getAttempt(id);
        expect(settled?.status.confirmation).toBe("unconfirmed");
        expect(settled?.recoveryActions ?? []).toEqual([]);
        expect(settled?.instruction?.state).toBe("not_sent");
        expect(settled?.error).toContain("Inspect the saved session");
        return;
      }
      expect(connection.startupAttempts.getAttempt(id)?.status.phase).toBe("failed");
      expect(connection.startupAttempts.getAttempt(id)?.recoveryActions?.[0]?.kind).toBe(
        "retry_message",
      );
      const retryMessage = connection.startupAttempts.getAttempt(id)?.recoveryActions?.[0]?.run;
      await act(async () => {
        await retryMessage?.();
      });
      expect(sendAgentMessage).toHaveBeenCalledTimes(1);
      const settled = connection.startupAttempts.getAttempt(id);
      expect(settled?.instruction?.state).toBe(outcome === "queued" ? "queued" : "accepted");
      expect(settled?.recoveryActions ?? []).toEqual([]);
      if (invalidatedAt === "retry") {
        expect(settled?.status.confirmation).toBe("unconfirmed");
        expect(settled?.status.phase).not.toBe("ready");
        expect(settled?.error).toContain(
          outcome === "queued" ? "The instruction was queued" : "The message was accepted",
        );
        expect(settled?.error).toContain("Inspect the saved session");
      } else expect(settled?.status.phase).toBe("ready");
      if (outcome === "acknowledged")
        expect(settled?.error).toContain("The transcript update failed after acceptance.");
      await act(async () => {
        await retryMessage?.();
      });
      expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      await connection.dispose();
    }
  },
);

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

test("retries an unsent first message on the prepared saved session through agent operations", async () => {
  const record = {
    externalSessionId: "native",
    runtimeKind: "codex" as const,
    workingDirectory: "/repo/task-worktree",
    startedAt: "2026-10-08T00:00:00Z",
    role: "build" as const,
    selectedModel: null,
  };
  const native = { ...record, status: "idle" as const };
  const agentSessionWorkflowLaunch: HostClient["agentSessionWorkflowLaunch"] = mock(
    async (request): Promise<WorkflowLaunchResult> => {
      if (!request.startup) throw new Error("Missing startup context");
      return {
        workspaceId: request.workspaceId,
        repoPath: request.repoPath,
        taskId: request.taskId,
        role: "build",
        status: "failed",
        startMode: "fresh",
        session: native,
        unsentInstruction: [{ kind: "text", text: "Continue" }],
        failure: { message: "Runtime rejected the message", cleanupErrors: [] },
        startupProgress: {
          ...live.prepared({
            ...workspace,
            context: request.startup,
            scope: { kind: "task", taskId: "task", role: "build" },
            ownership: { state: "saved", target: { kind: "task", record, runtimeSession: native } },
          }),
          phase: "failed",
          instruction: { state: "not_sent" },
        },
      };
    },
  );
  const sendAgentMessage = mock(
    async (
      recipient: Parameters<AgentOperationsContextValue["sendAgentMessage"]>[0],
      ..._args: [Parameters<AgentOperationsContextValue["sendAgentMessage"]>[1]]
    ): Promise<AgentMessageSendReceipt> => ({
      outcome: "acknowledged",
      recipient,
      submissionId: "retried-message",
      postAcceptanceFailure: null,
    }),
  );
  const connection = createConnection({ agentSessionWorkflowLaunch });
  const live = createStartupLiveSourceFake(connection.queryClient);
  const view = renderHook(() => useSessionStartWorkflowRunner(workspace), {
    wrapper: createWrapper(connection, createAgentOperationsFixture({ sendAgentMessage })),
  });
  try {
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
    });
    const attempt = connection.startupAttempts.getSnapshot()[0]!;
    expect(attempt.recoveryActions?.[0]?.kind).toBe("retry_message");
    expect(sendAgentMessage).not.toHaveBeenCalled();
    await act(async () => {
      await attempt.recoveryActions?.[0]?.run();
    });
    expect(agentSessionWorkflowLaunch).toHaveBeenCalledTimes(1);
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(sendAgentMessage.mock.calls[0]?.[0]).toMatchObject({ externalSessionId: "native" });
    expect(sendAgentMessage.mock.calls[0]?.[1]).toEqual([{ kind: "text", text: "Continue" }]);
    expect(connection.startupAttempts.isReadyForHandoff(attempt.id)).toBe(true);
  } finally {
    view.unmount();
    await connection.dispose();
  }
});
