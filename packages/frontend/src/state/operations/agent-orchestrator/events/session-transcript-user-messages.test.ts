import { describe, expect, test } from "bun:test";
import {
  buildSession,
  createSessionsRef,
  createSessionUpdater,
  findSession,
  getSession,
  getSessionMessages,
  listenToAgentSessionEvents,
  type SessionEvent,
  type SessionEventAdapter,
  type SessionUpdateFn,
} from "./session-events-test-harness";

describe("agent-orchestrator session transcript events", () => {
  test("writes canonical user_message events into the transcript", async () => {
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

    const sessionsRef = createSessionsRef([buildSession()]);

    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "user_message",
      externalSessionId: "session-1",
      messageId: "user-message-1",
      timestamp: "2026-02-22T08:00:01.000Z",
      message: "Generate the pull request",
      parts: [{ kind: "text", text: "Generate the pull request" }],
      state: "read",
      model: {
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "Hephaestus",
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    const userMessages = getSessionMessages(sessionsRef).filter(
      (message) => message.role === "user",
    );
    expect(userMessages).toHaveLength(1);
    const userMessage = userMessages[0];
    expect(userMessage?.id).toBe("user-message-1");
    expect(userMessage?.content).toBe("Generate the pull request");
    expect(getSession(sessionsRef).status).toBe("running");
    if (userMessage?.meta?.kind !== "user") {
      throw new Error("Expected canonical user message metadata");
    }
    expect(userMessage.meta.parts).toEqual([
      {
        kind: "text",
        text: "Generate the pull request",
      },
    ]);
    expect(userMessage.meta.providerId).toBe("openai");
    expect(userMessage.meta.modelId).toBe("gpt-5");
    expect(userMessage.meta.variant).toBe("high");
    expect(userMessage.meta.profileId).toBe("Hephaestus");
    expect(userMessage.meta.state).toBe("read");
  });

  test("preserves attachment display parts on user_message events", async () => {
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

    const sessionsRef = createSessionsRef([buildSession()]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "user_message",
      externalSessionId: "session-1",
      messageId: "user-message-1",
      timestamp: "2026-02-22T08:00:01.000Z",
      message: "Inspect this",
      parts: [
        { kind: "text", text: "Inspect this" },
        {
          kind: "attachment",
          attachment: {
            id: "attachment-1",
            kind: "image",
            mime: "image/png",
            name: "screenshot.png",
            path: "/tmp/openducktor-local-attachments/screenshot.png",
          },
        },
      ],
      state: "read",
    });

    await Promise.resolve();
    await Promise.resolve();

    const userMessage = getSessionMessages(sessionsRef).find(
      (message) => message.id === "user-message-1",
    );
    if (userMessage?.meta?.kind !== "user") {
      throw new Error("Expected canonical user message metadata");
    }
    expect(userMessage.content).toBe("Inspect this");
    expect(userMessage.meta.parts).toEqual([
      { kind: "text", text: "Inspect this" },
      {
        kind: "attachment",
        attachment: {
          id: "attachment-1",
          kind: "image",
          mime: "image/png",
          name: "screenshot.png",
          path: "/tmp/openducktor-local-attachments/screenshot.png",
        },
      },
    ]);
  });

  test("upserts session compaction notices without replacing native lifecycle state", async () => {
    const handlers: Array<(event: SessionEvent) => void> = [];
    const updateSessionOptions: Array<Parameters<SessionUpdateFn>[2]> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };
    const previousMessage = {
      id: "assistant-1",
      role: "assistant" as const,
      content: "Working on it.",
      timestamp: "2026-05-18T21:00:00.000Z",
    };
    const protectedSessionState = {
      status: "running" as const,
      runtimeStatusMessage: "Runtime is still working",
      pendingUserMessageStartedAt: Date.parse("2026-05-18T21:00:00.000Z"),
      pendingApprovals: [
        {
          requestId: "approval-1",
          requestType: "command_execution" as const,
          title: "Run command",
        },
      ],
      pendingQuestions: [
        {
          requestId: "question-1",
          questions: [{ header: "Choice", question: "Proceed?", options: [] }],
        },
      ],
      todos: [
        {
          id: "todo-1",
          content: "Keep working",
          status: "in_progress" as const,
          priority: "high" as const,
        },
      ],
      contextUsage: {
        totalTokens: 12_000,
        contextWindow: 200_000,
        providerId: "openai",
        modelId: "gpt-5",
      },
      selectedModel: {
        providerId: "openai",
        modelId: "gpt-5",
        variant: "medium",
      },
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        role: "build",
        messages: [previousMessage],
        ...protectedSessionState,
      }),
    ]);

    const applySessionUpdate = createSessionUpdater(sessionsRef);
    const updateSession: SessionUpdateFn = (identity, updater, options) => {
      updateSessionOptions.push(options);
      return applySessionUpdate(identity, updater);
    };
    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "session_compaction_started",
      externalSessionId: "session-1",
      timestamp: "2026-05-18T21:00:30.000Z",
      messageId: "compact-live",
      message: "Session compaction started.",
    });
    handleEvent({
      type: "session_compaction_started",
      externalSessionId: "session-1",
      timestamp: "2026-05-18T21:00:31.000Z",
      messageId: "compact-live",
      message: "Session compaction started.",
    });
    expect(getSessionMessages(sessionsRef).at(-1)).toEqual(
      expect.objectContaining({
        id: "compact-live",
        role: "system",
        content: "Session compaction started.",
        timestamp: "2026-05-18T21:00:31.000Z",
        meta: {
          kind: "session_notice",
          tone: "info",
          reason: "session_compacted",
          title: "Compacting",
          compactionStatus: "running",
        },
      }),
    );

    handleEvent({
      type: "session_compacted",
      externalSessionId: "session-1",
      timestamp: "2026-05-18T21:01:00.000Z",
      messageId: "compact-live",
      message: "Session compacted.",
    });
    handleEvent({
      type: "session_compacted",
      externalSessionId: "session-1",
      timestamp: "2026-05-18T21:01:00.000Z",
      messageId: "compact-live",
      message: "Session compacted.",
    });

    const session = findSession(sessionsRef, "session-1");
    if (!session) {
      throw new Error("Expected session to exist");
    }
    const messages = getSessionMessages(sessionsRef);
    const compactedNotice = messages.at(-1);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(previousMessage);
    expect(compactedNotice).toEqual(
      expect.objectContaining({
        id: "compact-live",
        role: "system",
        content: "Session compacted.",
        timestamp: "2026-05-18T21:01:00.000Z",
        meta: {
          kind: "session_notice",
          tone: "info",
          reason: "session_compacted",
          title: "Compacted",
          compactionStatus: "completed",
        },
      }),
    );
    expect(updateSessionOptions).toEqual([
      { persist: true },
      { persist: true },
      { persist: true },
      { persist: true },
    ]);
    expect(session).toEqual(
      expect.objectContaining({
        ...protectedSessionState,
        status: "running",
      }),
    );
  });

  test("merges queued user_message updates in place when the agent reads the turn", async () => {
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

    const sessionsRef = createSessionsRef([buildSession()]);

    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "user_message",
      externalSessionId: "session-1",
      messageId: "user-message-queued",
      timestamp: "2026-02-22T08:00:01.000Z",
      message: "Queued follow-up",
      parts: [{ kind: "text", text: "Queued follow-up" }],
      state: "queued",
    });
    handleEvent({
      type: "user_message",
      externalSessionId: "session-1",
      messageId: "user-message-queued",
      timestamp: "2026-02-22T08:00:01.000Z",
      message: "Queued follow-up",
      parts: [{ kind: "text", text: "Queued follow-up" }],
      state: "read",
    });

    const userMessages = getSessionMessages(sessionsRef).filter(
      (message) => message.role === "user",
    );
    expect(userMessages).toHaveLength(1);
    const userMessage = userMessages[0];
    expect(userMessage?.content).toBe("Queued follow-up");
    if (userMessage?.meta?.kind !== "user") {
      throw new Error("Expected queued user message metadata");
    }
    expect(userMessage.meta.parts).toEqual([
      {
        kind: "text",
        text: "Queued follow-up",
      },
    ]);
    expect(userMessage.meta.state).toBe("read");
  });
});
