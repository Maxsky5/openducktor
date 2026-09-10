import { describe, expect, mock, test } from "bun:test";
import { createHostClient } from "@openducktor/host-client";
import type { AcceptedAgentUserMessage, AgentSessionSummary } from "@openducktor/core";
import { createAgentRuntimeServices } from "./agent-runtime-services";
import { host } from "./operations/shared/host";

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
        // @ts-expect-error This negative test verifies rejection of an unknown runtime kind.
        runtimeKind: "test-runtime",
      }),
    ).rejects.toThrow();
  });

  test("rejects mismatched runtime policy bindings before dispatching a pure adapter read", () => {
    const { agentEngine } = createAgentRuntimeServices();
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
      ).rejects.toThrow("Workflow sessions must start through agentSessionWorkflowStart.");
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

  test("routes all nine queries through the host for every runtime", async () => {
    const calls: { command: string; args: unknown }[] = [];
    const client = createHostClient(async (command, args, schema) => {
      calls.push({ command, args });
      if (command.endsWith("list_models"))
        return schema.parse({ models: [], defaultModelsByProvider: {} });
      if (command.endsWith("list_slash_commands")) return schema.parse({ commands: [] });
      if (command.endsWith("list_skills")) return schema.parse({ skills: [] });
      if (command.endsWith("list_subagents")) return schema.parse({ subagents: [] });
      return schema.parse([]);
    });
    const { agentEngine } = createAgentRuntimeServices(client);
    for (const runtimeKind of ["opencode", "claude", "codex"] as const) {
      const ref = {
        runtimeKind,
        repoPath: "/remote/repo",
        workingDirectory: "/remote/repo/worktree",
        externalSessionId: "native-session",
      };
      const policy =
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
          : runtimeKind === "claude"
            ? ({ ...ref, runtimeKind, runtimePolicy: { kind: runtimeKind } } as const)
            : ({ ...ref, runtimeKind, runtimePolicy: { kind: runtimeKind } } as const);
      await agentEngine.listAvailableModels({ repoPath: ref.repoPath, runtimeKind });
      await agentEngine.listAvailableSlashCommands({
        repoPath: ref.repoPath,
        workingDirectory: ref.workingDirectory,
        runtimeKind,
      });
      await agentEngine.listAvailableSkills({
        repoPath: ref.repoPath,
        workingDirectory: ref.workingDirectory,
        runtimeKind,
      });
      await agentEngine.listAvailableSubagents({
        repoPath: ref.repoPath,
        workingDirectory: ref.workingDirectory,
        runtimeKind,
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
      expect(calls.slice(-9).map(({ command }) => command)).toEqual([
        "agent_runtime_list_models",
        "agent_runtime_list_slash_commands",
        "agent_runtime_list_skills",
        "agent_runtime_list_subagents",
        "agent_runtime_search_files",
        "agent_runtime_load_session_history",
        "agent_runtime_load_session_todos",
        "agent_runtime_load_session_diff",
        "agent_runtime_file_status",
      ]);
      expect(calls.at(-4)?.args).toEqual({ input: { ...policy, limit: 5 } });
      expect(calls.at(-2)?.args).toEqual({ input: { ...ref, runtimeHistoryAnchor: "turn-1" } });
    }
    expect(calls).toHaveLength(27);
  });
});
