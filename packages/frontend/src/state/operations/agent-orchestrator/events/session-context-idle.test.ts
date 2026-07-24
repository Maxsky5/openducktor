import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  buildSession,
  createSessionsRef,
  createSessionTurnMetadata,
  createSessionUpdater,
  findSession,
  getSession,
  getSessionMessages,
  listenToAgentSessionEvents,
  type SessionEventAdapter,
  sessionMessageAt,
} from "./session-events-test-harness";

describe("agent-orchestrator session context usage and idle settlement", () => {
  test("does not derive host-owned context usage from transcript step tokens", async () => {
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
          variant: "high",
          profileId: "Hephaestus",
        },
      }),
    ]);
    const turnMetadata = createSessionTurnMetadata();
    turnMetadata.recordModel("session-1", {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "Hephaestus",
    });

    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      turnMetadata,
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
        kind: "step",
        messageId: "assistant-live-1",
        partId: "step-finish-1",
        phase: "finish",
        reason: "tool-calls",
        totalTokens: 35_022,
        contextWindow: 200_000,
      },
    });

    expect(findSession(sessionsRef, "session-1")?.contextUsage).toBeNull();
  });

  test("does not mark a step message as tokenized when the step update is ignored", async () => {
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
    const turnMetadata = createSessionTurnMetadata();

    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      turnMetadata,
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
        kind: "step",
        messageId: "assistant-live-1",
        partId: "step-finish-1",
        phase: "finish",
        reason: "tool-calls",
        totalTokens: 0,
      },
    });

    expect(findSession(sessionsRef, "session-1")?.contextUsage).toBeNull();
    expect(
      turnMetadata.hasContextUsageMessageId(
        agentSessionIdentityKey(getSession(sessionsRef)),
        "assistant-live-1",
      ),
    ).toBe(false);
  });

  test("keeps host-owned context independent from in-flight turn model changes", async () => {
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
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "anthropic",
          modelId: "claude-sonnet",
          profileId: "Hephaestus",
        },
      }),
    ]);
    const sessionKey = agentSessionIdentityKey(getSession(sessionsRef));
    const turnMetadata = createSessionTurnMetadata();
    turnMetadata.recordModel(sessionKey, {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "Hephaestus",
    });

    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      turnMetadata,
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
        kind: "step",
        messageId: "assistant-live-1",
        partId: "step-finish-1",
        phase: "finish",
        reason: "tool-calls",
        totalTokens: 35_022,
        contextWindow: 200_000,
      },
    });

    expect(findSession(sessionsRef, "session-1")?.contextUsage).toBeNull();
  });

  test("does not derive context usage from step or final transcript messages", async () => {
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
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
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
      timestamp: "2026-02-22T08:00:01.000Z",
      part: {
        kind: "text",
        messageId: "assistant-live-1",
        partId: "text-1",
        text: "Final answer",
        completed: true,
      },
    });

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.000Z",
      part: {
        kind: "step",
        messageId: "assistant-live-1",
        partId: "step-finish-1",
        phase: "finish",
        reason: "tool-calls",
        totalTokens: 35_022,
        contextWindow: 200_000,
      },
    });

    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "assistant-live-1",
      timestamp: "2026-02-22T08:00:03.000Z",
      message: "Final answer",
    });

    expect(findSession(sessionsRef, "session-1")?.contextUsage).toBeNull();
    expect(sessionMessageAt(getSession(sessionsRef), 0)?.meta).toMatchObject({
      kind: "assistant",
      isFinal: true,
    });
    expect(sessionMessageAt(getSession(sessionsRef), 0)?.meta).not.toMatchObject({
      totalTokens: 35_022,
      contextWindow: 200_000,
    });
  });

  test("does not derive context usage before an assistant transcript row exists", async () => {
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
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
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
        kind: "step",
        messageId: "assistant-live-1",
        partId: "step-finish-1",
        phase: "finish",
        reason: "tool-calls",
        totalTokens: 35_022,
        contextWindow: 200_000,
      },
    });

    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "assistant-live-1",
      timestamp: "2026-02-22T08:00:03.000Z",
      message: "Final answer",
    });

    expect(findSession(sessionsRef, "session-1")?.contextUsage).toBeNull();
    expect(sessionMessageAt(getSession(sessionsRef), 0)?.meta).toMatchObject({
      kind: "assistant",
      isFinal: true,
    });
    expect(sessionMessageAt(getSession(sessionsRef), 0)?.meta).not.toMatchObject({
      totalTokens: 35_022,
      contextWindow: 200_000,
    });
  });

  test("preserves host-owned context across transcript events without a live usage update", async () => {
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
        contextUsage: {
          totalTokens: 35_022,
          contextWindow: 200_000,
          outputLimit: 8_192,
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "Hephaestus",
        },
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
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
      timestamp: "2026-02-22T08:00:01.000Z",
      part: {
        kind: "text",
        messageId: "assistant-live-2",
        partId: "text-1",
        text: "Fresh answer",
        completed: true,
      },
    });

    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "assistant-live-2",
      timestamp: "2026-02-22T08:00:02.000Z",
      message: "Fresh answer",
    });

    expect(findSession(sessionsRef, "session-1")?.contextUsage).toEqual({
      totalTokens: 35_022,
      contextWindow: 200_000,
      outputLimit: 8_192,
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "Hephaestus",
    });
    expect(sessionMessageAt(getSession(sessionsRef), 0)?.meta).toMatchObject({
      kind: "assistant",
      agentRole: "spec",
      isFinal: true,
    });
    expect(sessionMessageAt(getSession(sessionsRef), 0)?.meta).not.toMatchObject({
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "Hephaestus",
    });
    expect(sessionMessageAt(getSession(sessionsRef), 0)?.meta).not.toMatchObject({
      totalTokens: 35_022,
    });
  });

  test("keeps reasoning-only deltas out of assistant transcript messages", async () => {
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

    const sessionsRef = createSessionsRef([buildSession({ role: "build", status: "idle" })]);

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
      type: "assistant_delta",
      externalSessionId: "session-1",
      channel: "reasoning",
      messageId: "assistant-message-reasoning",
      delta: "Reason silently",
      timestamp: "2026-02-22T08:00:02.000Z",
    });

    expect(
      getSessionMessages(sessionsRef).some((message) =>
        message.content.includes("Reason silently"),
      ),
    ).toBe(false);

    handleEvent({
      type: "session_idle",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:03.000Z",
    });

    expect(
      getSessionMessages(sessionsRef).some(
        (message) => message.role === "assistant" && message.content.includes("Reason silently"),
      ),
    ).toBe(false);
  });

  test("keeps starting sessions active when an early idle event arrives before kickoff send", async () => {
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

    const sessionsRef = createSessionsRef([buildSession({ role: "build", status: "starting" })]);

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
      type: "session_idle",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:03.000Z",
    });

    expect(findSession(sessionsRef, "session-1")?.status).toBe("starting");
  });

  test("settles pending outbound sends when the runtime emits idle", async () => {
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
        role: "build",
        status: "running",
        pendingUserMessageStartedAt: 123,
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
      type: "session_idle",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:03.000Z",
    });

    expect(findSession(sessionsRef, "session-1")?.status).toBe("idle");
    expect(findSession(sessionsRef, "session-1")?.pendingUserMessageStartedAt).toBeUndefined();
  });

  test("keeps streamed text messages through terminal idle settlement", async () => {
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

    const sessionsRef = createSessionsRef([buildSession({ role: "build", status: "idle" })]);

    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession,
      resolveTurnDurationMs: () => 120,
      clearTurnDuration: () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "assistant_delta",
      externalSessionId: "session-1",
      channel: "text",
      messageId: "assistant-buffered-1",
      delta: "Buffered answer",
      timestamp: "2026-02-22T08:00:02.000Z",
    });

    handleEvent({
      type: "session_idle",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:03.000Z",
    });

    expect(
      getSessionMessages(sessionsRef).some(
        (message) => message.id === "assistant-buffered-1" && message.content === "Buffered answer",
      ),
    ).toBe(true);
    const streamedAssistant = getSessionMessages(sessionsRef).find(
      (message) => message.id === "assistant-buffered-1",
    );
    expect(streamedAssistant?.meta).toMatchObject({ kind: "assistant", isFinal: false });
  });

  test("upserts the finalized assistant message instead of appending a duplicate", async () => {
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
        messages: [
          {
            id: "msg-final",
            role: "assistant",
            content: "Final answer",
            timestamp: "2026-02-22T08:00:03.000Z",
          },
        ],
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
      resolveTurnDurationMs: () => 120,
      clearTurnDuration: () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "msg-final",
      message: "Final answer",
      timestamp: "2026-02-22T08:00:04.000Z",
      model: {
        providerId: "openai",
        modelId: "gpt-5",
        profileId: "Hephaestus",
      },
    });

    const assistantMessages = getSessionMessages(sessionsRef).filter(
      (entry) => entry.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages?.[0]?.id).toBe("msg-final");
    expect(assistantMessages?.[0]?.meta?.kind).toBe("assistant");
  });
});
