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
import {
  createTestClientConnection,
  createTestHostConnection,
} from "../../test-support/test-client-connection";
import type { StartupProgressListener } from "../../connection/host-connection";
import { createAgentSessionsStore } from "../agent-sessions-store";
import { AgentOperationsContext, AgentSessionsContext } from "../session-contexts";
import { taskWorktreeQueryOptions } from "../../queries/build-runtime";
import { terminalQueryKeys } from "../../queries/terminals";
import type { AgentOperationsContextValue } from "../../types/session-slices";
import { useSessionStartWorkflowRunner } from "./use-session-start-workflow-runner";
import { createAgentOperationsFixture } from "../../test-support/agent-operations-fixture";
import { createStartupLiveSourceFake } from "../../test-support/startup-live-source-fake";
import type { AgentMessageSendReceipt } from "../../types/agent-orchestrator";
import {
  registerStartupLiveSource,
  retainStartupPreparationWorkspaces,
} from "../startup/startup-prepared-handoff";
import { startupIsPending } from "../startup/startup-navigation";
import { startupFailureRows } from "../startup/startup-trace";

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
  { outcome: "accepted", invalidatedAt: "observation" },
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
      if (invalidatedAt === "observation") {
        retainStartupPreparationWorkspaces(connection.queryClient, []);
        registerStartupLiveSource(connection.queryClient, {
          observeWorkspace: () => () => {},
          observeAgentSessionLive: async () => {
            throw new Error("Reopen the workspace to observe session progress.");
          },
        });
      }
      await act(async () => {
        const repair = connection.startupAttempts.getAttempt(id)?.recoveryActions?.[0]?.run();
        if (invalidatedAt === "observation")
          expect(connection.startupAttempts.getAttempt(id)?.status.phase).toBe("submitting");
        await repair;
      });
      if (invalidatedAt === "observation") {
        expect(requests).toHaveLength(1);
        const failed = connection.startupAttempts.getAttempt(id);
        expect(failed?.ownership).toEqual({ state: "saved", target: { kind: "task", record } });
        expect(failed?.status).toEqual({ phase: "failed", confirmation: "current" });
        expect(failed?.error).toBe("Reopen the workspace to observe session progress.");
        expect(sendAgentMessage).not.toHaveBeenCalled();
        return;
      }
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

test.each(["acknowledged", "uncertain", "refused", "not_sent"] as const)(
  "retains a busy saved-session message retry until it settles as %s",
  async (outcome) => {
    const record = {
      externalSessionId: "native",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/task-worktree",
      startedAt: "2026-10-08T00:00:00Z",
      role: "build" as const,
      selectedModel: null,
    };
    const native = { ...record, status: "idle" as const };
    let publish: StartupProgressListener | undefined;
    const agentSessionWorkflowLaunch: HostClient["agentSessionWorkflowLaunch"] = mock(
      async (request): Promise<WorkflowLaunchResult> => {
        if (!request.startup) throw new Error("Missing startup context");
        const prepared = live.prepared({
          ...workspace,
          context: request.startup,
          scope: { kind: "task", taskId: "task", role: "build" },
          ownership: {
            state: "saved",
            target: { kind: "task", record, runtimeSession: native },
          },
        });
        await publish?.({
          channel: "openducktor://session-startup-progress",
          payload: { ...prepared, phase: "running", instruction: { state: "submitting" } },
        });
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
            ...prepared,
            revision: prepared.revision + 1,
            phase: "failed",
            instruction: { state: "not_sent" },
          },
        };
      },
    );
    const sent = Promise.withResolvers<AgentMessageSendReceipt | null>();
    const sendAgentMessage = mock(
      async (
        _recipient: Parameters<AgentOperationsContextValue["sendAgentMessage"]>[0],
        ..._args: [Parameters<AgentOperationsContextValue["sendAgentMessage"]>[1]]
      ): Promise<AgentMessageSendReceipt | null> => sent.promise,
    );
    const connection = createTestClientConnection({
      host: createTestHostConnection({
        client: { agentSessionWorkflowLaunch },
        subscribeStartupProgress: async (listener) => {
          publish = listener;
          return () => {};
        },
      }),
    });
    const live = createStartupLiveSourceFake(connection.queryClient);
    const view = renderHook(() => useSessionStartWorkflowRunner(workspace), {
      wrapper: createWrapper(connection, createAgentOperationsFixture({ sendAgentMessage })),
    });
    let retry: void | Promise<void> = undefined;
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
      expect(attempt.status).toEqual({ phase: "failed", confirmation: "current" });
      expect(attempt.instruction?.state).toBe("not_sent");
      expect(attempt.recoveryActions?.[0]?.kind).toBe("retry_message");
      expect(sendAgentMessage).not.toHaveBeenCalled();
      const retryMessage = attempt.recoveryActions![0]!.run;
      await act(async () => {
        retry = retryMessage();
        await retryMessage();
      });
      const operation = attempt.operations[0];
      if (!publish || !operation) throw new Error("Missing initial startup progress");
      const result = { type: "exited" as const, exitCode: 0, signal: null, outputTail: ["Ready"] };
      const progress = {
        ...operation,
        revision: operation.revision + 1,
        steps: [
          {
            id: "setup",
            label: "Run setup",
            state: "completed" as const,
            details: [],
            action: {
              actionId: "setup",
              command: "bun install",
              waitBeforeAgentStart: false,
              result,
            },
          },
        ],
      };
      await act(async () => {
        await publish!({
          channel: "openducktor://session-startup-progress",
          payload: progress,
        });
      });
      const pending = connection.startupAttempts.getAttempt(attempt.id);
      expect(pending?.status).toEqual({ phase: "submitting", confirmation: "current" });
      expect(startupIsPending(pending)).toBe(true);
      expect(pending?.recoveryActions).toBeUndefined();
      expect(pending?.instruction?.state).toBe("submitting");
      expect(pending?.ownership).toEqual(attempt.ownership);
      expect(pending?.prepared).toEqual(attempt.prepared);
      expect(pending?.operations).toHaveLength(1);
      expect(pending?.operations[0]?.context).toEqual(operation.context);
      expect(pending?.operations[0]?.steps[0]?.action?.result).toEqual(result);
      connection.startupAttempts.dismiss(attempt.id);
      expect(connection.startupAttempts.getAttempt(attempt.id)).toBe(pending);
      expect(agentSessionWorkflowLaunch).toHaveBeenCalledTimes(1);
      expect(sendAgentMessage).toHaveBeenCalledTimes(1);
      expect(sendAgentMessage.mock.calls[0]?.[0]).toMatchObject({ externalSessionId: "native" });
      expect(sendAgentMessage.mock.calls[0]?.[1]).toEqual([{ kind: "text", text: "Continue" }]);
      await act(async () => {
        if (outcome === "refused") sent.reject(new Error("Message refused"));
        else if (outcome === "not_sent") sent.resolve(null);
        else if (outcome === "uncertain")
          sent.resolve({ outcome, recipient: native, submissionId: "retried-message" });
        else
          sent.resolve({
            outcome,
            recipient: native,
            submissionId: "retried-message",
            postAcceptanceFailure: null,
          });
        await retry;
      });
      const beforeLateResult = connection.startupAttempts.getAttempt(attempt.id)!;
      const failure = {
        stage: "setup",
        code: "exit",
        message: "Setup failed",
        nextAction: "Inspect setup.",
      };
      await act(async () => {
        await publish!({
          channel: "openducktor://session-startup-progress",
          payload: {
            ...progress,
            revision: progress.revision + 1,
            steps: progress.steps.map((step) => ({
              ...step,
              state: "failed",
              failure,
              action: { ...step.action, result: { ...result, exitCode: 1 } },
            })),
          },
        });
      });
      const settled = connection.startupAttempts.getAttempt(attempt.id);
      expect(settled?.operations[0]?.revision).toBe(progress.revision + 1);
      expect(settled?.error).toBe(beforeLateResult.error);
      expect(settled?.recoveryActions).toEqual(beforeLateResult.recoveryActions);
      expect(settled?.status.successExpiresAt).toBe(beforeLateResult.status.successExpiresAt);
      expect(startupFailureRows(settled!).map(({ step }) => step.failure)).toEqual([failure]);
      if (outcome === "refused" || outcome === "not_sent") {
        expect(settled?.status).toEqual({ phase: "failed", confirmation: "current" });
        expect(settled?.instruction?.state).toBe("not_sent");
        expect(settled?.recoveryActions?.map((action) => action.kind)).toEqual(["retry_message"]);
        expect(startupIsPending(settled)).toBe(false);
        await act(async () => {
          await settled?.recoveryActions?.[0]?.run();
        });
        expect(sendAgentMessage).toHaveBeenCalledTimes(2);
        expect(agentSessionWorkflowLaunch).toHaveBeenCalledTimes(1);
      } else if (outcome === "uncertain") {
        expect(settled?.status).toEqual({ phase: "failed", confirmation: "unconfirmed" });
        expect(settled?.instruction?.state).toBe("unknown");
        expect(settled?.recoveryActions).toEqual([]);
        expect(connection.startupAttempts.isReadyForHandoff(attempt.id)).toBe(false);
      } else expect(connection.startupAttempts.isReadyForHandoff(attempt.id)).toBe(true);
    } finally {
      sent.resolve(null);
      await retry;
      view.unmount();
      await connection.dispose();
    }
  },
);
