import { describe, expect, mock, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { RuntimeKind } from "@openducktor/contracts";
import type { AcceptedAgentUserMessage, AgentSessionSummary } from "@openducktor/core";
import { createAgentRuntimeServices } from "./agent-runtime-services";
import { host } from "./operations/shared/host";

const sessionSummary: AgentSessionSummary = {
  externalSessionId: "external-started",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  role: "build",
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

describe("agent runtime services", () => {
  test("exposes the shipped runtime definitions through the engine boundary", () => {
    const { agentEngine } = createAgentRuntimeServices();

    expect(agentEngine.listRuntimeDefinitions().map((runtime) => runtime.kind)).toEqual([
      "opencode",
      "codex",
      "claude",
    ]);
  });

  test("rejects unsupported runtime kinds at the service boundary", async () => {
    const { runtimeCatalogOperations } = createAgentRuntimeServices();

    await expect(
      runtimeCatalogOperations.loadRepoRuntimeCatalog({
        repoPath: "/repo",
        runtimeKind: "test-runtime" as RuntimeKind,
      }),
    ).rejects.toThrow("Unsupported agent runtime 'test-runtime'.");
  });

  test("rejects mismatched runtime policy bindings before dispatching a pure adapter read", () => {
    const { agentEngine } = createAgentRuntimeServices();

    expect(() =>
      agentEngine.loadSessionTodos({
        runtimeKind: "opencode",
        repoPath: "/repo",
        workingDirectory: "/tmp/repo",
        externalSessionId: "external-1",
        runtimePolicy: {
          kind: "codex",
          policy: {
            sandboxMode: "workspace-write",
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            commandNetworkAccess: false,
            approvalsReviewerApplies: true,
          },
        },
      } as never),
    ).toThrow(
      "Cannot load OpenCode session todos with runtime 'opencode' and 'codex' runtime policy.",
    );
  });

  test("delegates every live session control to the generic host boundary", async () => {
    const originalStart = host.agentSessionControlStart;
    const originalResume = host.agentSessionControlResume;
    const originalFork = host.agentSessionControlFork;
    const originalSend = host.agentSessionControlSend;
    const originalUpdateModel = host.agentSessionControlUpdateModel;
    const originalStop = host.agentSessionControlStop;
    const originalRelease = host.agentSessionControlRelease;
    const start = mock(async () => sessionSummary);
    const resume = mock(async () => sessionSummary);
    const fork = mock(async () => sessionSummary);
    const send = mock(async () => acceptedUserMessage);
    const updateModel = mock(async () => undefined);
    const stop = mock(async () => undefined);
    const release = mock(async () => undefined);

    host.agentSessionControlStart = start;
    host.agentSessionControlResume = resume;
    host.agentSessionControlFork = fork;
    host.agentSessionControlSend = send;
    host.agentSessionControlUpdateModel = updateModel;
    host.agentSessionControlStop = stop;
    host.agentSessionControlRelease = release;

    try {
      const { agentEngine } = createAgentRuntimeServices();
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
          sessionScope,
          systemPrompt: "Build",
        }),
      ).resolves.toEqual(sessionSummary);
      await agentEngine.resumeSession({ ...sessionRef, sessionScope });
      await agentEngine.forkSession({
        repoPath: sessionRef.repoPath,
        runtimeKind: sessionRef.runtimeKind,
        workingDirectory: sessionRef.workingDirectory,
        sessionScope,
        systemPrompt: "Build",
        parentExternalSessionId: "parent-1",
      });
      await expect(
        agentEngine.sendUserMessage({
          ...sessionRef,
          sessionScope,
          parts: [{ kind: "text", text: "Continue" }],
        }),
      ).resolves.toEqual(acceptedUserMessage);
      await agentEngine.updateSessionModel({ ...sessionRef, model: null });
      await agentEngine.stopSession(sessionRef);
      await agentEngine.releaseSession(sessionRef);

      expect(start).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledWith({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        sessionScope,
        systemPrompt: "Build",
      });
      expect(resume).toHaveBeenCalledTimes(1);
      expect(resume).toHaveBeenCalledWith({ ...sessionRef, sessionScope });
      expect(fork).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({
        ...sessionRef,
        sessionScope,
        parts: [{ kind: "text", text: "Continue" }],
      });
      expect(updateModel).toHaveBeenCalledTimes(1);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      host.agentSessionControlStart = originalStart;
      host.agentSessionControlResume = originalResume;
      host.agentSessionControlFork = originalFork;
      host.agentSessionControlSend = originalSend;
      host.agentSessionControlUpdateModel = originalUpdateModel;
      host.agentSessionControlStop = originalStop;
      host.agentSessionControlRelease = originalRelease;
    }
  });

  test("keeps pure runtime reads bound to their renderer adapters", async () => {
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const listAvailableModels = mock(async () => ({
      models: [],
      defaultModelsByProvider: {},
    }));
    const loadSessionTodos = mock(async () => []);

    try {
      OpencodeSdkAdapter.prototype.listAvailableModels = listAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = loadSessionTodos;

      const { agentEngine } = createAgentRuntimeServices();
      const { listAvailableModels: readModels, loadSessionTodos: readTodos } = agentEngine;

      await readModels({ runtimeKind: "opencode", repoPath: "/repo" });
      await readTodos({
        runtimeKind: "opencode",
        repoPath: "/repo",
        workingDirectory: "/tmp/repo",
        externalSessionId: "external-1",
        runtimePolicy: { kind: "opencode" },
      });

      expect(listAvailableModels).toHaveBeenCalledTimes(1);
      expect(loadSessionTodos).toHaveBeenCalledTimes(1);
    } finally {
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
    }
  });
});
