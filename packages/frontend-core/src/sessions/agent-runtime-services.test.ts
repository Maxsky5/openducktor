import { describe, expect, mock, test } from "bun:test";
import { createHostClient, type HostClient } from "@openducktor/host-client";
import { QueryClient } from "@tanstack/react-query";
import type { AcceptedAgentUserMessage, AgentSessionSummary } from "@openducktor/core";
import {
  createAgentRuntimeServices,
  getAcceptedMessageAfterSendFailure,
  getAgentSessionResumeFailureNotice,
} from "./agent-runtime-services";
import { HostInvokeError } from "@openducktor/host-client";
import { createAgentMessageQueueSnapshot } from "../test-support/agent-message-send-fixture";
import { createTestHostConnection } from "../test-support/test-client-connection";

const createServices = (client: HostClient = createTestHostConnection().client) =>
  createAgentRuntimeServices(client, new QueryClient());

const sessionSummary: AgentSessionSummary = {
  externalSessionId: "external-started",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
  startedAt: "2026-02-22T09:00:00.000Z",
  status: "running",
};

const acceptedUserMessage: AcceptedAgentUserMessage = {
  type: "user_message",
  externalSessionId: sessionSummary.externalSessionId,
  timestamp: "2026-02-22T09:00:01.000Z",
  messageId: "message-1",
  message: "Continue",
  parts: [],
  state: "read",
};

describe("getAgentSessionResumeFailureNotice", () => {
  test("names the cause and the next action for a typed resume failure", () => {
    const error = new HostInvokeError("Continuation failed", {
      kind: "agent_session_resume",
      agentSessionResumeFailure: {
        reason: "live_turn",
        sessionRef: {
          repoPath: "/repo",
          runtimeKind: "codex",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        },
        operation: "agent-session.continue-interrupted-turn",
        message: "Codex session 'session-1' has a live turn.",
        nextAction: "Wait for the live turn to finish, then retry Resume.",
      },
    });

    expect(getAgentSessionResumeFailureNotice(error)).toEqual({
      reason: "live_turn",
      text: "Codex session 'session-1' has a live turn. Wait for the live turn to finish, then retry Resume.",
    });
  });

  test("ignores other host failures", () => {
    expect(getAgentSessionResumeFailureNotice(new HostInvokeError("other"))).toBeNull();
  });
});

describe("agent runtime services", () => {
  test("acceptance failure conversion requires the exact session reference", () => {
    const ref = {
      repoPath: "/repo",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: sessionSummary.externalSessionId,
    };
    const error = new HostInvokeError("Accepted but not saved", {
      kind: "agent_session_message_accepted",
      sessionRef: ref,
      stage: "record_message",
      acceptedMessage: {
        ...acceptedUserMessage,
        model: { providerId: "p", modelId: "m", profileId: "profile", variant: undefined },
      },
    });
    const accepted = getAcceptedMessageAfterSendFailure(error, ref);
    expect(accepted?.type === "user_message" ? accepted.model : null).toEqual({
      providerId: "p",
      modelId: "m",
      profileId: "profile",
    });
    for (const changed of [
      { repoPath: "/other" },
      { workingDirectory: "/other" },
      { externalSessionId: "other" },
      { runtimeKind: "codex" as const },
    ]) {
      expect(getAcceptedMessageAfterSendFailure(error, { ...ref, ...changed })).toBeNull();
    }
    expect(getAcceptedMessageAfterSendFailure(new HostInvokeError("Rejected"), ref)).toBeNull();
  });
  test("exposes the shipped runtime definitions through the engine boundary", () => {
    const { agentEngine } = createServices();

    expect(agentEngine.listRuntimeDefinitions().map((runtime) => runtime.kind)).toEqual([
      "opencode",
      "codex",
      "claude",
    ]);
  });

  test("rejects unsupported runtime kinds at the service boundary", async () => {
    const { runtimeCatalogOperations } = createServices();

    await expect(
      runtimeCatalogOperations.loadRuntimeCatalog({
        repoPath: "/repo",
        workingDirectory: "/repo",
        // @ts-expect-error This negative test verifies rejection of an unknown runtime kind.
        runtimeKind: "test-runtime",
      }),
    ).rejects.toThrow();
  });

  test("rejects mismatched runtime policy bindings before dispatching a pure adapter read", () => {
    const { agentEngine } = createServices();
    const runtimePolicy = {
      kind: "codex",
      policy: {
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        commandNetworkAccess: false,
        approvalsReviewerApplies: true,
      },
    } satisfies NonNullable<Parameters<typeof agentEngine.loadSessionTodos>[0]["runtimePolicy"]>;

    expect(() =>
      // @ts-expect-error This negative test verifies rejection of a mismatched runtime-policy discriminator.
      agentEngine.loadSessionTodos({
        runtimeKind: "opencode",
        repoPath: "/repo",
        workingDirectory: "/tmp/repo",
        externalSessionId: "external-1",
        runtimePolicy,
      }),
    ).toThrow();
  });

  test("delegates every live session control to the generic host boundary", async () => {
    const start = mock(async () => sessionSummary);
    const resume = mock(async () => sessionSummary);
    const fork = mock(async () => sessionSummary);
    const submit = mock(async () => ({
      kind: "accepted" as const,
      acceptedMessage: acceptedUserMessage,
    }));
    const queue = createAgentMessageQueueSnapshot({
      target: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: sessionSummary.externalSessionId,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      },
      revision: 2,
    });
    const manageQueue = mock(async () => ({ queue, acceptedMessage: acceptedUserMessage }));
    const updateModel = mock(async () => undefined);
    const stop = mock(async () => undefined);
    const release = mock(async () => undefined);

    const { client } = createTestHostConnection({
      client: {
        agentSessionControlStart: start,
        agentSessionControlResume: resume,
        agentSessionControlFork: fork,
        agentSessionMessageSubmit: submit,
        agentSessionMessageQueueManage: manageQueue,
        agentSessionControlUpdateModel: updateModel,
        agentSessionControlStop: stop,
        agentSessionControlRelease: release,
      },
    });

    const { agentEngine } = createServices(client);
    const sessionRef = {
      repoPath: "/repo",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: sessionSummary.externalSessionId,
    };
    const sessionScope = { kind: "workflow" as const, taskId: "task-1", role: "build" as const };

    await expect(
      agentEngine.startSession({
        repoPath: sessionRef.repoPath,
        runtimeKind: sessionRef.runtimeKind,
        workingDirectory: sessionRef.workingDirectory,
        sessionScope: { kind: "repository" },
        systemPrompt: "Build",
      }),
    ).resolves.toEqual(sessionSummary);
    await expect(
      agentEngine.startSession({
        repoPath: sessionRef.repoPath,
        runtimeKind: sessionRef.runtimeKind,
        workingDirectory: sessionRef.workingDirectory,
        sessionScope,
        systemPrompt: "Build",
      }),
    ).rejects.toThrow("Workflow sessions must start through agentSessionWorkflowLaunch.");
    await agentEngine.resumeSession({ ...sessionRef, sessionScope, resumeMode: "reattach" });
    await agentEngine.forkSession({
      repoPath: sessionRef.repoPath,
      runtimeKind: sessionRef.runtimeKind,
      workingDirectory: sessionRef.workingDirectory,
      sessionScope,
      systemPrompt: "Build",
      parentExternalSessionId: "parent-1",
    });
    expect(
      await agentEngine.submitUserMessage({
        ...sessionRef,
        sessionScope,
        submissionId: "submission-1",
        mode: "default",
        parts: [{ kind: "text", text: "Continue" }],
      }),
    ).toEqual({ kind: "accepted", acceptedMessage: acceptedUserMessage });
    expect(
      await agentEngine.manageMessageQueue({
        ...sessionRef,
        sessionScope,
        action: { kind: "steer", submissionId: "submission-1" },
      }),
    ).toEqual({ queue, acceptedMessage: acceptedUserMessage });
    await agentEngine.updateSessionModel({ ...sessionRef, sessionScope, model: null });
    await agentEngine.stopSession(sessionRef);
    await agentEngine.releaseSession(sessionRef);

    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({
      repoPath: "/repo",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree",
      sessionScope: { kind: "repository" },
      systemPrompt: "Build",
    });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledWith({
      ...sessionRef,
      sessionScope,
      resumeMode: "reattach",
    });
    expect(fork).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({
      ...sessionRef,
      sessionScope,
      submissionId: "submission-1",
      mode: "default",
      parts: [{ kind: "text", text: "Continue" }],
    });
    expect(manageQueue).toHaveBeenCalledTimes(1);
    expect(manageQueue).toHaveBeenCalledWith({
      ...sessionRef,
      sessionScope,
      action: { kind: "steer", submissionId: "submission-1" },
    });
    expect(updateModel).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("routes every catalog and session query through the host for every runtime", async () => {
    const calls: { command: string; args: unknown }[] = [];
    const client = createHostClient(async (command, args, schema) => {
      calls.push({ command, args });
      if (command.endsWith("load_catalog")) {
        return schema.parse({
          models: {
            status: "available",
            catalog: { models: [], defaultModelsByProvider: {} },
          },
        });
      }
      return schema.parse([]);
    });
    const { agentEngine } = createServices(client);
    for (const runtimeKind of ["opencode", "claude", "codex"] as const) {
      const ref = {
        runtimeKind,
        repoPath: "/remote/repo",
        workingDirectory: "/remote/repo/worktree",
        externalSessionId: "native-session",
      };
      // SAFETY: The test builds the loader input for the codex runtime policy contract.
      const policy = (
        runtimeKind === "codex"
          ? ({
              ...ref,
              runtimeKind,
              runtimePolicy: {
                kind: runtimeKind,
                policy: {
                  sandboxMode: "workspace-write",
                  approvalPolicy: "on-request",
                  approvalsReviewer: "user",
                  commandNetworkAccess: false,
                  approvalsReviewerApplies: true,
                },
              },
            } as const)
          : ({ ...ref, runtimeKind, runtimePolicy: { kind: runtimeKind } } as const)
      ) as Parameters<typeof agentEngine.loadSessionHistory>[0];
      const catalog = await agentEngine.loadRuntimeCatalog({
        repoPath: ref.repoPath,
        workingDirectory: ref.workingDirectory,
        runtimeKind,
      });
      expect(catalog.models).toEqual({
        status: "available",
        catalog: { models: [], defaultModelsByProvider: {} },
      });
      await agentEngine.searchFiles({
        repoPath: ref.repoPath,
        workingDirectory: ref.workingDirectory,
        runtimeKind,
        query: "src",
      });
      await agentEngine.loadSessionHistory({ ...policy, limit: 5 });
      await agentEngine.loadSessionTodos(policy);
      await agentEngine.loadSessionDiff({ ...ref, runtimeHistoryAnchor: "turn-1" });
      await agentEngine.loadFileStatus({
        repoPath: ref.repoPath,
        workingDirectory: ref.workingDirectory,
        runtimeKind,
      });
      expect(calls.slice(-6).map(({ command }) => command)).toEqual([
        "agent_runtime_load_catalog",
        "agent_runtime_search_files",
        "agent_runtime_load_session_history",
        "agent_runtime_load_session_todos",
        "agent_runtime_load_session_diff",
        "agent_runtime_file_status",
      ]);
      expect(calls.at(-6)?.args).toEqual({
        input: {
          repoPath: "/remote/repo",
          runtimeKind,
          workingDirectory: "/remote/repo/worktree",
        },
      });
      expect(calls.at(-4)?.args).toEqual({ input: { ...policy, limit: 5 } });
      expect(calls.at(-2)?.args).toEqual({ input: { ...ref, runtimeHistoryAnchor: "turn-1" } });
    }
    expect(calls).toHaveLength(18);
  });

  test("reads one full tool part through the host", async () => {
    const part = {
      kind: "tool",
      messageId: "message",
      partId: "part",
      callId: "call",
      tool: "bash",
      toolType: "bash",
      status: "completed",
      output: "full",
    } as const;
    const calls: { command: string; args: unknown }[] = [];
    const client = createHostClient(async (command, args, schema) => {
      calls.push({ command, args });
      return schema.parse(part);
    });
    const ref = {
      repoPath: "/remote/repo",
      runtimeKind: "opencode",
      runtimePolicy: { kind: "opencode" },
      workingDirectory: "/remote/repo/worktree",
      externalSessionId: "native-session",
    } as const;
    const { agentEngine } = createServices(client);
    expect(
      await agentEngine.loadSessionToolPart({ ...ref, partId: "part", callId: "call" }),
    ).toEqual(part);
    expect(calls).toEqual([
      {
        command: "agent_runtime_load_session_tool_part",
        args: { input: { ...ref, partId: "part", callId: "call" } },
      },
    ]);
  });
});
