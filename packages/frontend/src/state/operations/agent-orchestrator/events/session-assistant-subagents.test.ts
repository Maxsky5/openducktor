import { describe, expect, mock, test } from "bun:test";
import {
  type AgentSessionState,
  attachAgentSessionListener,
  buildSession,
  getSession,
  getSessionMessages,
  handleAssistantPart,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type SessionEventAdapter,
  type SessionPartEventContext,
  sessionMessageAt,
} from "./session-events-test-harness";

describe("agent-orchestrator session assistant and subagent updates", () => {
  test("finalizes assistant draft through status transitions", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const turnStartedAtBySessionRef = { current: {} as Record<string, number> };
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "build" }),
      },
    };

    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      turnStartedAtBySessionRef,
      updateSession,
      resolveTurnDurationMs: () => 250,
      clearTurnDuration: () => {
        turnStartedAtBySessionRef.current["session-1"] = 0;
      },
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "session_status",
      externalSessionId: "session-1",
      status: { type: "busy" },
      timestamp: "2026-02-22T08:00:01.000Z",
    });
    handleEvent({
      type: "assistant_delta",
      externalSessionId: "session-1",
      channel: "text",
      messageId: "assistant-message-1",
      delta: "Partial answer",
      timestamp: "2026-02-22T08:00:02.000Z",
    });
    handleEvent({
      type: "session_status",
      externalSessionId: "session-1",
      status: { type: "retry", attempt: 1, message: '{"message":"Retrying"}' },
      timestamp: "2026-02-22T08:00:03.000Z",
    });
    handleEvent({
      type: "session_status",
      externalSessionId: "session-1",
      status: { type: "idle" },
      timestamp: "2026-02-22T08:00:04.000Z",
    });

    expect(sessionsRef.current["session-1"]?.status).toBe("idle");
    expect(sessionsRef.current["session-1"]?.draftAssistantText).toBe("");
    expect(
      getSessionMessages(sessionsRef).some(
        (message) => message.role === "assistant" && message.content.includes("Partial answer"),
      ),
    ).toBe(true);
    expect(
      getSessionMessages(sessionsRef).some(
        (message) => message.role === "system" && message.content.includes("Retrying"),
      ),
    ).toBe(true);
  });

  test("handles session start and assistant parts matrix", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    let refreshCalls = 0;
    let clearCalls = 0;

    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "build", status: "idle" }),
      },
    };

    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => 300,
      clearTurnDuration: () => {
        clearCalls += 1;
      },
      refreshTaskData: async () => {
        refreshCalls += 1;
      },
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "session_started",
      externalSessionId: "session-1",
      message: "Started",
      timestamp: "2026-02-22T08:00:01.000Z",
    });

    expect(sessionsRef.current["session-1"]?.status).toBe("running");
    expect(getSessionMessages(sessionsRef).length).toBeGreaterThan(0);

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.000Z",
      part: {
        kind: "text",
        messageId: "m1",
        partId: "p-text",
        text: "Draft from part",
        completed: false,
      },
    });

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.100Z",
      part: {
        kind: "reasoning",
        messageId: "m1",
        partId: "p-thinking",
        text: "Reasoning...",
        completed: true,
      },
    });

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.200Z",
      part: {
        kind: "tool",
        messageId: "m1",
        partId: "p-tool",
        callId: "call-1",
        tool: "odt_build_completed",
        toolType: "generic" as const,
        status: "completed",
        output: "done",
      },
    });

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.250Z",
      part: {
        kind: "tool",
        messageId: "m1",
        partId: "p-tool-fail",
        callId: "call-fail",
        tool: "odt_set_plan",
        toolType: "generic" as const,
        status: "error",
        error: "Input validation error",
      },
    });

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.275Z",
      part: {
        kind: "tool",
        messageId: "m1",
        partId: "p-tool-guard",
        callId: "call-guard",
        tool: "odt_set_spec",
        toolType: "generic" as const,
        status: "error",
        error:
          "set_spec is only allowed from open/spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review (current: deferred)",
      },
    });

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.300Z",
      part: {
        kind: "subagent",
        messageId: "m1",
        partId: "p-subtask-spawn",
        correlationKey: "spawn:m1:build:Do work",
        status: "running",
        agent: "build",
        prompt: "Do work",
        description: "Starting subagent",
        startedAtMs: 100,
      },
    });

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.350Z",
      part: {
        kind: "subagent",
        messageId: "m1",
        partId: "p-subtask-complete",
        correlationKey: "spawn:m1:build:Do work",
        status: "completed",
        agent: "build",
        prompt: "Do work",
        description: "Done subtask",
        externalSessionId: "session-child-1",
        startedAtMs: 100,
        endedAtMs: 300,
      },
    });

    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "m1",
      timestamp: "2026-02-22T08:00:03.000Z",
      message: "Final assistant output",
      totalTokens: 42,
      model: {
        providerId: "anthropic",
        modelId: "claude-3-7-sonnet",
        profileId: "Hephaestus",
        variant: "max",
      },
    });

    handleEvent({
      type: "assistant_delta",
      externalSessionId: "session-1",
      channel: "text",
      messageId: "m2",
      timestamp: "2026-02-22T08:00:03.500Z",
      delta: "Idle follow-up",
    });

    handleEvent({
      type: "session_idle",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:04.000Z",
    });

    expect(refreshCalls).toBe(1);
    expect(clearCalls).toBeGreaterThan(0);
    expect(sessionsRef.current["session-1"]?.status).toBe("idle");
    expect(
      getSessionMessages(sessionsRef).some(
        (message) => message.role === "thinking" && message.content.includes("Reasoning"),
      ),
    ).toBe(true);
    expect(
      getSessionMessages(sessionsRef).some(
        (message) => message.role === "tool" && message.meta?.kind === "tool",
      ),
    ).toBe(true);
    expect(
      getSessionMessages(sessionsRef).some(
        (message) =>
          message.role === "tool" &&
          message.meta?.kind === "tool" &&
          message.meta.tool === "odt_set_plan" &&
          message.meta.status === "error",
      ),
    ).toBe(true);
    expect(
      getSessionMessages(sessionsRef).some(
        (message) =>
          message.role === "tool" &&
          message.meta?.kind === "tool" &&
          message.meta.tool === "odt_set_spec" &&
          message.meta.status === "error",
      ),
    ).toBe(true);
    expect(
      getSessionMessages(sessionsRef).some(
        (message) =>
          message.role === "system" && message.content.includes("Subagent (build): Done subtask"),
      ),
    ).toBe(true);
    expect(
      getSessionMessages(sessionsRef).filter(
        (message) => message.role === "system" && message.meta?.kind === "subagent",
      ),
    ).toHaveLength(1);
    const subagentMessage = getSessionMessages(sessionsRef).find(
      (message) => message.role === "system" && message.meta?.kind === "subagent",
    );
    if (subagentMessage?.meta?.kind !== "subagent") {
      throw new Error("Expected subagent message with subagent meta");
    }
    expect(subagentMessage.meta.status).toBe("completed");
    expect(subagentMessage.meta.externalSessionId).toBe("session-child-1");
    expect(subagentMessage.meta.correlationKey).toBe("spawn:m1:build:Do work");
    expect(subagentMessage.meta.startedAtMs).toBe(100);
    expect(subagentMessage.meta.endedAtMs).toBe(300);
    expect(
      getSessionMessages(sessionsRef).some(
        (message) =>
          message.role === "assistant" && message.content.includes("Final assistant output"),
      ),
    ).toBe(true);
    const finalAssistantMessage = getSessionMessages(sessionsRef).find(
      (message) =>
        message.role === "assistant" && message.content.includes("Final assistant output"),
    );
    if (finalAssistantMessage?.meta?.kind !== "assistant") {
      throw new Error("Expected final assistant message with assistant meta");
    }
    expect(finalAssistantMessage.meta.profileId).toBe("Hephaestus");
    expect(finalAssistantMessage.meta.modelId).toBe("claude-3-7-sonnet");
    expect(
      getSessionMessages(sessionsRef).some(
        (message) => message.role === "assistant" && message.content.includes("Idle follow-up"),
      ),
    ).toBe(true);
  });

  test("writes live text parts into transcript messages instead of draft state", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          role: "spec",
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
            profileId: "Hephaestus",
          },
        }),
      },
    };

    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.000Z",
      part: {
        kind: "text",
        messageId: "assistant-live-1",
        partId: "part-1",
        text: "First pass",
        completed: false,
      },
    });

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.100Z",
      part: {
        kind: "text",
        messageId: "assistant-live-1",
        partId: "part-1",
        text: "First pass refined",
        completed: true,
      },
    });

    const assistantMessages = getSessionMessages(sessionsRef).filter(
      (message) => message.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages?.[0]?.id).toBe("assistant-live-1");
    expect(assistantMessages?.[0]?.content).toBe("First pass refined");
    expect(sessionsRef.current["session-1"]?.draftAssistantText).toBe("");
  });

  test("records explicit tool start timing for live assistant turns", () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "build" }),
      },
    };
    const recordTurnActivityTimestamp = mock(() => {});

    const context: SessionPartEventContext = {
      store: {
        externalSessionId: "session-1",
        sessionsRef,
        updateSession: (externalSessionId, updater) => {
          const current = sessionsRef.current[externalSessionId];
          if (!current) {
            return;
          }
          sessionsRef.current = {
            ...sessionsRef.current,
            [externalSessionId]: updater(current),
          };
        },
      },
      drafts: {
        externalSessionId: "session-1",
        draftRawBySessionRef: { current: {} },
        draftSourceBySessionRef: { current: {} },
        draftMessageIdBySessionRef: { current: {} },
        draftFlushTimeoutBySessionRef: { current: {} },
      },
      turn: {
        externalSessionId: "session-1",
        turnStartedAtBySessionRef: { current: {} },
        recordTurnActivityTimestamp,
        resolveTurnDurationMs: () => undefined,
        clearTurnDuration: () => {},
      },
      refresh: {
        repoPath: "/tmp/repo",
        refreshTaskData: async () => {},
        resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
      },
    };

    handleAssistantPart(context, {
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.000Z",
      part: {
        kind: "tool",
        messageId: "assistant-live-1",
        partId: "tool-part-1",
        callId: "call-1",
        tool: "bash",
        toolType: "generic" as const,
        status: "completed",
        startedAtMs: 100,
        endedAtMs: 300,
      },
    });

    expect(recordTurnActivityTimestamp).toHaveBeenCalledWith("session-1", 100);
  });

  test("forwards turn timing callbacks to part handlers through attachAgentSessionListener", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "build" }),
      },
    };
    const recordTurnActivityTimestamp = mock(() => {});
    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionsRef,
      externalSessionId: "session-1",
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      recordTurnActivityTimestamp,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
      contextUsageMessageIdBySessionRef: { current: {} },
      turnModelBySessionRef: { current: {} },
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler");
    }

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.000Z",
      part: {
        kind: "subagent",
        messageId: "assistant-live-1",
        partId: "subagent-1",
        correlationKey: "part:assistant-live-1:subagent-1",
        status: "running",
        agent: "build",
        prompt: "Inspect repo",
        description: "Starting A",
        startedAtMs: 100,
      },
    });

    expect(recordTurnActivityTimestamp).toHaveBeenCalledWith("session-1", 100);
  });

  test("reuses the spawned subagent row when a later update adds externalSessionId", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "build" }),
      },
    };
    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionsRef,
      externalSessionId: "session-1",
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
      contextUsageMessageIdBySessionRef: { current: {} },
      turnModelBySessionRef: { current: {} },
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler");
    }

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.300Z",
      part: {
        kind: "subagent",
        messageId: "m1",
        partId: "p-subtask-spawn",
        correlationKey: "spawn:m1:build:Do work",
        status: "running",
        agent: "build",
        prompt: "Do work",
        description: "Starting subagent",
        startedAtMs: 100,
      },
    });

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.350Z",
      part: {
        kind: "subagent",
        messageId: "m1",
        partId: "p-subtask-complete",
        correlationKey: "spawn:m1:build:Do work",
        status: "completed",
        agent: "build",
        prompt: "Do work",
        description: "Done subtask",
        externalSessionId: "session-child-1",
        startedAtMs: 100,
        endedAtMs: 300,
      },
    });

    const subagentMessages = getSessionMessages(sessionsRef).filter(
      (message) => message.role === "system" && message.meta?.kind === "subagent",
    );
    expect(subagentMessages).toHaveLength(1);
    expect(subagentMessages[0]?.id).toBe("subagent:spawn:m1:build:Do work");
    if (subagentMessages[0]?.meta?.kind !== "subagent") {
      throw new Error("Expected subagent meta");
    }
    expect(subagentMessages[0].meta.externalSessionId).toBe("session-child-1");
    expect(subagentMessages[0].meta.status).toBe("completed");
  });

  test("syncs child pending approvals when a live subagent row becomes linked", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const readSessionPresence = mock(async () => ({
      presence: "runtime" as const,
      ref: {
        repoPath: "/tmp/repo",
        runtimeKind: "opencode" as const,
        workingDirectory: "/tmp/repo",
        externalSessionId: "session-child-1",
      },
      runtimeId: "runtime-1",
      title: "Read omp.json file",
      startedAt: "2026-02-22T08:00:02.000Z",
      classification: "waiting_for_permission" as const,
      status: { type: "busy" as const },
      agentSessionStatus: "running" as const,
      pendingApprovals: [
        {
          requestId: "perm-child-1",
          requestType: "permission_grant" as const,
          title: "Approve permission: read",
          summary: "OpenCode requested approval for read.",
          affectedPaths: ["/tmp/outside.json"],
          action: { name: "read" },
          mutation: "read_only" as const,
          supportedReplyOutcomes: ["approve_once" as const, "reject" as const],
        },
      ],
      pendingQuestions: [],
    }));
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
      readSessionPresence,
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "planner" }),
      },
    };
    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionsRef,
      externalSessionId: "session-1",
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
      contextUsageMessageIdBySessionRef: { current: {} },
      turnModelBySessionRef: { current: {} },
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler");
    }

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.000Z",
      part: {
        kind: "subagent",
        messageId: "m1",
        partId: "p-subtask-spawn-1",
        correlationKey: "session:m1:session-child-1",
        status: "running",
        agent: "explorer",
        prompt: "Read file",
        description: "Read omp.json file",
        externalSessionId: "session-child-1",
        startedAtMs: 100,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(readSessionPresence).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo",
      externalSessionId: "session-child-1",
    });
    expect(
      sessionsRef.current["session-1"]?.subagentPendingApprovalsByExternalSessionId?.[
        "session-child-1"
      ],
    ).toEqual([
      {
        requestId: "perm-child-1",
        requestType: "permission_grant",
        title: "Approve permission: read",
        summary: "OpenCode requested approval for read.",
        affectedPaths: ["/tmp/outside.json"],
        action: { name: "read" },
        mutation: "read_only",
        supportedReplyOutcomes: ["approve_once", "reject"],
      },
    ]);
  });

  test("follows up linked running subagents when pending approval appears after the link", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    let readCount = 0;
    const readSessionPresence = mock(async () => {
      readCount += 1;
      return {
        presence: "runtime" as const,
        ref: {
          repoPath: "/tmp/repo",
          runtimeKind: "opencode" as const,
          workingDirectory: "/tmp/repo",
          externalSessionId: "session-child-1",
        },
        runtimeId: "runtime-1",
        title: "Read omp.json file",
        startedAt: "2026-02-22T08:00:02.000Z",
        classification:
          readCount === 1 ? ("running" as const) : ("waiting_for_permission" as const),
        status: { type: "busy" as const },
        agentSessionStatus: "running" as const,
        pendingApprovals:
          readCount === 1
            ? []
            : [
                {
                  requestId: "perm-child-1",
                  requestType: "permission_grant" as const,
                  title: "Approve permission: read",
                  summary: "OpenCode requested approval for read.",
                  affectedPaths: ["/tmp/outside.json"],
                  action: { name: "read" },
                  mutation: "read_only" as const,
                  supportedReplyOutcomes: ["approve_once" as const, "reject" as const],
                },
              ],
        pendingQuestions: [],
      };
    });
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
      readSessionPresence,
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "planner" }),
      },
    };
    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionsRef,
      externalSessionId: "session-1",
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
      contextUsageMessageIdBySessionRef: { current: {} },
      turnModelBySessionRef: { current: {} },
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler");
    }

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.000Z",
      part: {
        kind: "subagent",
        messageId: "m1",
        partId: "p-subtask-spawn-1",
        correlationKey: "session:m1:session-child-1",
        status: "running",
        agent: "explorer",
        prompt: "Read file",
        description: "Read omp.json file",
        externalSessionId: "session-child-1",
        startedAtMs: 100,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(readSessionPresence).toHaveBeenCalledTimes(2);
    expect(
      sessionsRef.current["session-1"]?.subagentPendingApprovalsByExternalSessionId?.[
        "session-child-1"
      ]?.map((entry) => entry.requestId),
    ).toEqual(["perm-child-1"]);
  });

  test("preserves live subagent runtime error details", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "build" }),
      },
    };
    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionsRef,
      externalSessionId: "session-1",
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
      contextUsageMessageIdBySessionRef: { current: {} },
      turnModelBySessionRef: { current: {} },
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler");
    }

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:05:02.300Z",
      part: {
        kind: "subagent",
        messageId: "m1",
        partId: "p-subtask-error",
        correlationKey: "spawn:m1:explorer:Read the file at ~/maxsky5.omp.json",
        status: "error",
        agent: "explorer",
        prompt: "Read the file at ~/maxsky5.omp.json",
        description: "Read the file at ~/maxsky5.omp.json",
        error: "Timed out after 5m while waiting for permission.",
        startedAtMs: 100,
        endedAtMs: 300_100,
      },
    });

    const subagentMessages = getSessionMessages(sessionsRef).filter(
      (message) => message.role === "system" && message.meta?.kind === "subagent",
    );
    expect(subagentMessages).toHaveLength(1);

    const subagent = subagentMessages[0];
    if (subagent?.meta?.kind !== "subagent") {
      throw new Error("Expected subagent message with subagent meta");
    }
    expect(subagent.meta.status).toBe("error");
    expect(subagent.meta.error).toBe("Timed out after 5m while waiting for permission.");
    expect(subagent.content).toContain("Read the file at ~/maxsky5.omp.json");
  });

  test("keeps same-prompt subagents separate until an exact identity match arrives", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "build" }),
      },
    };
    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionsRef,
      externalSessionId: "session-1",
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
      contextUsageMessageIdBySessionRef: { current: {} },
      turnModelBySessionRef: { current: {} },
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler");
    }

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.300Z",
      part: {
        kind: "subagent",
        messageId: "m1",
        partId: "p-subtask-spawn-1",
        correlationKey: "spawn:m1:build:Do work",
        status: "running",
        agent: "build",
        prompt: "Do work",
        description: "Starting first subagent",
        startedAtMs: 100,
      },
    });

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.325Z",
      part: {
        kind: "subagent",
        messageId: "m2",
        partId: "p-subtask-spawn-2",
        correlationKey: "spawn:m2:build:Do work",
        status: "running",
        agent: "build",
        prompt: "Do work",
        description: "Starting second subagent",
        startedAtMs: 125,
      },
    });

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.350Z",
      part: {
        kind: "subagent",
        messageId: "m1",
        partId: "p-subtask-complete-1",
        correlationKey: "spawn:m1:build:Do work",
        status: "completed",
        agent: "build",
        prompt: "Do work",
        description: "First subagent done",
        externalSessionId: "session-child-1",
        startedAtMs: 100,
        endedAtMs: 300,
      },
    });

    const subagentMessages = getSessionMessages(sessionsRef).filter(
      (message) => message.role === "system" && message.meta?.kind === "subagent",
    );
    expect(subagentMessages).toHaveLength(2);

    const firstSubagent = subagentMessages.find(
      (message) => message.id === "subagent:spawn:m1:build:Do work",
    );
    const secondSubagent = subagentMessages.find(
      (message) => message.id === "subagent:spawn:m2:build:Do work",
    );
    if (firstSubagent?.meta?.kind !== "subagent" || secondSubagent?.meta?.kind !== "subagent") {
      throw new Error("Expected subagent meta");
    }

    expect(firstSubagent.meta.externalSessionId).toBe("session-child-1");
    expect(firstSubagent.meta.status).toBe("completed");
    expect(secondSubagent.meta.externalSessionId).toBeUndefined();
    expect(secondSubagent.meta.status).toBe("running");
  });

  test("preserves cancelled subagent updates on the existing live row", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "build" }),
      },
    };
    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionsRef,
      externalSessionId: "session-1",
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
      contextUsageMessageIdBySessionRef: { current: {} },
      turnModelBySessionRef: { current: {} },
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler");
    }

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.300Z",
      part: {
        kind: "subagent",
        messageId: "m1",
        partId: "p-subtask-spawn",
        correlationKey: "spawn:m1:build:Do work",
        status: "running",
        agent: "build",
        prompt: "Do work",
        description: "Starting subagent",
        startedAtMs: 100,
      },
    });

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.350Z",
      part: {
        kind: "subagent",
        messageId: "m1",
        partId: "p-subtask-cancelled",
        correlationKey: "spawn:m1:build:Do work",
        status: "cancelled",
        agent: "build",
        prompt: "Do work",
        description: "Cancelled by user",
        externalSessionId: "session-child-1",
        startedAtMs: 100,
        endedAtMs: 250,
      },
    });

    const subagentMessages = getSessionMessages(sessionsRef).filter(
      (message) => message.role === "system" && message.meta?.kind === "subagent",
    );
    expect(subagentMessages).toHaveLength(1);
    expect(subagentMessages[0]?.id).toBe("subagent:spawn:m1:build:Do work");
    if (subagentMessages[0]?.meta?.kind !== "subagent") {
      throw new Error("Expected subagent meta");
    }
    expect(subagentMessages[0].meta.status).toBe("cancelled");
    expect(subagentMessages[0].meta.externalSessionId).toBe("session-child-1");
    expect(subagentMessages[0].meta.startedAtMs).toBe(100);
    expect(subagentMessages[0].meta.endedAtMs).toBe(250);
  });

  test("absorbs a unique fallback session-correlated subagent row into the existing live row", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "build" }),
      },
    };
    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionsRef,
      externalSessionId: "session-1",
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
      contextUsageMessageIdBySessionRef: { current: {} },
      turnModelBySessionRef: { current: {} },
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler");
    }

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.300Z",
      part: {
        kind: "subagent",
        messageId: "m1",
        partId: "p-subtask-spawn",
        correlationKey: "part:m1:p-subtask-spawn",
        status: "running",
        agent: "build",
        prompt: "Do work",
        description: "Starting subagent",
        startedAtMs: 100,
      },
    });

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.350Z",
      part: {
        kind: "subagent",
        messageId: "m2",
        partId: "p-subtask-complete",
        correlationKey: "session:m2:session-child-1",
        status: "completed",
        agent: "build",
        prompt: "Do work",
        description: "Done subtask",
        externalSessionId: "session-child-1",
        startedAtMs: 100,
        endedAtMs: 300,
      },
    });

    const subagentMessages = getSessionMessages(sessionsRef).filter(
      (message) => message.role === "system" && message.meta?.kind === "subagent",
    );
    expect(subagentMessages).toHaveLength(1);
    const subagent = subagentMessages[0];
    if (subagent?.meta?.kind !== "subagent") {
      throw new Error("Expected subagent meta");
    }
    expect(subagent.id).toBe("subagent:part:m1:p-subtask-spawn");
    expect(subagent.meta.correlationKey).toBe("session:m2:session-child-1");
    expect(subagent.meta.externalSessionId).toBe("session-child-1");
    expect(subagent.meta.status).toBe("completed");
    expect(subagent.meta.startedAtMs).toBe(100);
    expect(subagent.meta.endedAtMs).toBe(300);
  });

  test("keeps fallback session-correlated subagent rows separate when multiple same-prompt live rows exist", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "build" }),
      },
    };
    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionsRef,
      externalSessionId: "session-1",
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
      contextUsageMessageIdBySessionRef: { current: {} },
      turnModelBySessionRef: { current: {} },
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler");
    }

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.300Z",
      part: {
        kind: "subagent",
        messageId: "m1",
        partId: "p-subtask-spawn-1",
        correlationKey: "part:m1:p-subtask-spawn-1",
        status: "running",
        agent: "build",
        prompt: "Do work",
        description: "Starting subagent 1",
        startedAtMs: 100,
      },
    });

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.325Z",
      part: {
        kind: "subagent",
        messageId: "m2",
        partId: "p-subtask-spawn-2",
        correlationKey: "part:m2:p-subtask-spawn-2",
        status: "running",
        agent: "build",
        prompt: "Do work",
        description: "Starting subagent 2",
        startedAtMs: 120,
      },
    });

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.350Z",
      part: {
        kind: "subagent",
        messageId: "m3",
        partId: "p-subtask-complete",
        correlationKey: "session:m3:session-child-1",
        status: "completed",
        agent: "build",
        prompt: "Do work",
        description: "Done subtask",
        externalSessionId: "session-child-1",
        startedAtMs: 100,
        endedAtMs: 300,
      },
    });

    const subagentMessages = getSessionMessages(sessionsRef).filter(
      (message) => message.role === "system" && message.meta?.kind === "subagent",
    );
    expect(subagentMessages).toHaveLength(3);
  });

  test("matches an older assistant message when the newest same-text message is outside the timestamp window", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          messages: [
            {
              id: "assistant-older-match",
              role: "assistant",
              content: "Stable output",
              timestamp: "2026-02-22T08:00:10.000Z",
            },
            {
              id: "assistant-newer-miss",
              role: "assistant",
              content: "Stable output",
              timestamp: "2026-02-22T08:00:20.000Z",
            },
          ],
        }),
      },
    };

    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "assistant-final",
      timestamp: "2026-02-22T08:00:11.000Z",
      message: "Stable output",
    });

    expect(getSessionMessages(sessionsRef)).toHaveLength(3);
    expect(sessionMessageAt(getSession(sessionsRef), 0)?.id).toBe("assistant-older-match");
    expect(sessionMessageAt(getSession(sessionsRef), 1)?.id).toBe("assistant-newer-miss");
    expect(sessionMessageAt(getSession(sessionsRef), 2)?.id).toBe("assistant-final");
  });
});
