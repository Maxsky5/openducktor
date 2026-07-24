import { describe, expect, mock, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  buildSession,
  createSessionsRef,
  createSessionTurnMetadata,
  createSessionUpdater,
  findSession,
  getSession,
  getSessionMessages,
  handleAssistantPart,
  listenToAgentSessionEvents,
  type SessionEventAdapter,
  type SessionPartEventContext,
  sessionMessageAt,
} from "./session-events-test-harness";

describe("agent-orchestrator session assistant and subagent updates", () => {
  test("keeps streamed assistant text through status transitions", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const recordedActivityTimestamps: Array<string | number> = [];
    let clearTurnDurationCalls = 0;
    const sessionsRef = createSessionsRef([buildSession({ role: "build" })]);

    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession,
      recordTurnActivityTimestamp: (_externalSessionId, timestamp) => {
        recordedActivityTimestamps.push(timestamp);
      },
      resolveTurnDurationMs: () => 250,
      clearTurnDuration: () => {
        clearTurnDurationCalls += 1;
      },
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "session_status",
      externalSessionId: "session-1",
      status: { type: "busy", message: null },
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

    expect(findSession(sessionsRef, "session-1")?.status).toBe("idle");
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
    expect(recordedActivityTimestamps).toEqual([
      "2026-02-22T08:00:01.000Z",
      "2026-02-22T08:00:02.000Z",
    ]);
    expect(clearTurnDurationCalls).toBe(1);
  });

  test.each(["idle", "stopped", "error"] as const)(
    "keeps an inactive parent session %s when a background subagent completes late",
    async (inactiveStatus) => {
      const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
      const adapter: SessionEventAdapter = {
        subscribeEvents: async (_externalSessionId, handler) => {
          handlers.push(
            handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
          );
          return () => {};
        },
        replyApproval: async () => {},
      };

      const sessionsRef = createSessionsRef([buildSession({ role: "build" })]);
      const updateSession = createSessionUpdater(sessionsRef);
      const recordedActivityTimestamps: Array<string | number> = [];

      await listenToAgentSessionEvents({
        adapter,
        repoPath: "/tmp/repo",
        externalSessionId: "session-1",
        sessionsRef,
        updateSession,
        recordTurnActivityTimestamp: (_externalSessionId, timestamp) => {
          recordedActivityTimestamps.push(timestamp);
        },
        resolveTurnDurationMs: () => 300,
        clearTurnDuration: () => {},
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
          kind: "subagent",
          messageId: "assistant-background-task",
          partId: "subtask-background",
          correlationKey: "part:assistant-background-task:subtask-background",
          status: "running",
          agent: "fixer",
          prompt: "Run build",
          description: "Run build",
          externalSessionId: "child-background-session",
          executionMode: "background",
          startedAtMs: Date.parse("2026-02-22T08:00:02.000Z"),
        },
      });

      expect(findSession(sessionsRef, "session-1")?.status).toBe("running");
      expect(recordedActivityTimestamps).toEqual([Date.parse("2026-02-22T08:00:02.000Z")]);

      if (inactiveStatus === "idle") {
        handleEvent({
          type: "session_status",
          externalSessionId: "session-1",
          status: { type: "idle" },
          timestamp: "2026-02-22T08:00:05.000Z",
        });
      } else {
        updateSession(getSession(sessionsRef), (current) => ({
          ...current,
          status: inactiveStatus,
        }));
      }

      expect(findSession(sessionsRef, "session-1")?.status).toBe(inactiveStatus);

      handleEvent({
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:35.000Z",
        part: {
          kind: "subagent",
          messageId: "assistant-background-task",
          partId: "tool-background-task-running",
          correlationKey: "part:assistant-background-task:subtask-background",
          status: "running",
          description: "Background task still running",
          externalSessionId: "child-background-session",
          executionMode: "background",
          startedAtMs: Date.parse("2026-02-22T08:00:02.000Z"),
        },
      });

      expect(findSession(sessionsRef, "session-1")?.status).toBe(inactiveStatus);
      expect(recordedActivityTimestamps).toEqual([Date.parse("2026-02-22T08:00:02.000Z")]);

      handleEvent({
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:45.000Z",
        part: {
          kind: "subagent",
          messageId: "user-background-task-completed",
          partId: "text-background-task-completed",
          correlationKey: "part:assistant-background-task:subtask-background",
          status: "completed",
          description: "Background task completed: Run build",
          externalSessionId: "child-background-session",
          executionMode: "background",
          endedAtMs: Date.parse("2026-02-22T08:00:45.000Z"),
        },
      });

      expect(findSession(sessionsRef, "session-1")?.status).toBe(inactiveStatus);
      const subagentMessage = getSessionMessages(sessionsRef).find(
        (message) => message.role === "system" && message.meta?.kind === "subagent",
      );
      if (subagentMessage?.meta?.kind !== "subagent") {
        throw new Error("Expected subagent message with subagent meta");
      }
      expect(subagentMessage.meta.status).toBe("completed");
      expect(subagentMessage.meta.externalSessionId).toBe("child-background-session");
      expect(subagentMessage.meta.endedAtMs).toBe(Date.parse("2026-02-22T08:00:45.000Z"));
      expect(recordedActivityTimestamps).toEqual([Date.parse("2026-02-22T08:00:02.000Z")]);
    },
  );

  test("keeps an idle parent idle when a foreground subagent completes late", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([buildSession({ role: "build" })]);
    const updateSession = createSessionUpdater(sessionsRef);
    const recordedActivityTimestamps: Array<string | number> = [];

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession,
      recordTurnActivityTimestamp: (_externalSessionId, timestamp) => {
        recordedActivityTimestamps.push(timestamp);
      },
      resolveTurnDurationMs: () => 300,
      clearTurnDuration: () => {},
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
        kind: "subagent",
        messageId: "assistant-task",
        partId: "subtask",
        correlationKey: "part:assistant-task:subtask",
        status: "running",
        prompt: "Inspect the repository",
        description: "Inspect the repository",
        externalSessionId: "child-session",
        startedAtMs: Date.parse("2026-02-22T08:00:02.000Z"),
      },
    });
    expect(findSession(sessionsRef, "session-1")?.status).toBe("running");
    expect(recordedActivityTimestamps).toEqual([Date.parse("2026-02-22T08:00:02.000Z")]);

    handleEvent({
      type: "session_status",
      externalSessionId: "session-1",
      status: { type: "idle" },
      timestamp: "2026-02-22T08:00:05.000Z",
    });

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:25.000Z",
      part: {
        kind: "subagent",
        messageId: "assistant-task-completed",
        partId: "subtask-completed",
        correlationKey: "part:assistant-task:subtask",
        status: "completed",
        description: "Inspection completed",
        externalSessionId: "child-session",
        endedAtMs: Date.parse("2026-02-22T08:00:25.000Z"),
      },
    });

    expect(findSession(sessionsRef, "session-1")?.status).toBe("idle");
    const subagentMessage = getSessionMessages(sessionsRef).find(
      (message) => message.role === "system" && message.meta?.kind === "subagent",
    );
    if (subagentMessage?.meta?.kind !== "subagent") {
      throw new Error("Expected subagent message with subagent meta");
    }
    expect(subagentMessage.meta.status).toBe("completed");
    expect(recordedActivityTimestamps).toEqual([Date.parse("2026-02-22T08:00:02.000Z")]);
  });

  test("handles session start and assistant parts matrix", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    let clearCalls = 0;

    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([buildSession({ role: "build", status: "idle" })]);

    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession,
      resolveTurnDurationMs: () => 300,
      clearTurnDuration: () => {
        clearCalls += 1;
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

    expect(findSession(sessionsRef, "session-1")?.status).toBe("running");
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
          "set_spec is only allowed from open/spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review (current: closed)",
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

    expect(clearCalls).toBeGreaterThan(0);
    expect(findSession(sessionsRef, "session-1")?.status).toBe("idle");
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

  test("writes live text parts into transcript messages", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        role: "spec",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          profileId: "Hephaestus",
        },
      }),
    ]);

    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
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
  });

  test("records explicit tool start timing for live assistant turns", async () => {
    const sessionsRef = createSessionsRef([buildSession({ role: "build" })]);
    const recordTurnActivityTimestamp = mock(() => {});
    const session = getSession(sessionsRef);
    const sessionKey = agentSessionIdentityKey(session);

    const context: SessionPartEventContext = {
      session: {
        identity: session,
        key: sessionKey,
        repoPath: "/tmp/repo",
      },
      store: {
        updateSession: createSessionUpdater(sessionsRef),
        readSession: (identity) => findSession(sessionsRef, identity.externalSessionId) ?? null,
        ensureSession: (_identity, createSession) => createSession(),
        isSessionObserved: (identity) => identity.externalSessionId === session.externalSessionId,
      },
      turn: {
        turnMetadata: createSessionTurnMetadata(),
        recordTurnActivityTimestamp,
        recordTurnUserMessageTimestamp: () => {},
        resolveTurnDurationMs: () => undefined,
        clearTurnDuration: () => {},
      },
      todos: {
        updateSessionTodos: () => {},
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

    expect(recordTurnActivityTimestamp).toHaveBeenCalledWith(sessionKey, 100);
  });

  test("forwards turn timing callbacks to part handlers through listenToAgentSessionEvents", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([buildSession({ role: "build" })]);
    const recordTurnActivityTimestamp = mock(() => {});
    const updateSession = createSessionUpdater(sessionsRef);
    const sessionKey = agentSessionIdentityKey(getSession(sessionsRef));

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      sessionsRef,
      externalSessionId: "session-1",
      updateSession,
      recordTurnActivityTimestamp,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
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

    expect(recordTurnActivityTimestamp).toHaveBeenCalledWith(sessionKey, 100);
  });

  test("reuses the spawned subagent row when a later update adds externalSessionId", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([buildSession({ role: "build" })]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      sessionsRef,
      externalSessionId: "session-1",
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
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

  test("preserves live subagent runtime error details", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([buildSession({ role: "build" })]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      sessionsRef,
      externalSessionId: "session-1",
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
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

  test("keeps same-prompt subagents separate until an exact identity match arrives", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([buildSession({ role: "build" })]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      sessionsRef,
      externalSessionId: "session-1",
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
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

  test("preserves cancelled subagent updates on the existing live row", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([buildSession({ role: "build" })]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      sessionsRef,
      externalSessionId: "session-1",
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
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

  test("bridges a unique session-scoped subagent update into the existing part-scoped live row", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([buildSession({ role: "build" })]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      sessionsRef,
      externalSessionId: "session-1",
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
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

  test("keeps session-scoped subagent updates separate when multiple same-prompt live rows exist", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([buildSession({ role: "build" })]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      sessionsRef,
      externalSessionId: "session-1",
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
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

  test("matches an older assistant message when the newest same-text message is outside the timestamp window", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([
      buildSession({
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
    ]);

    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
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
