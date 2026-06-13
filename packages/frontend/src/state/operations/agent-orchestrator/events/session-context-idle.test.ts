import { describe, expect, test } from "bun:test";
import {
  type AgentSessionState,
  buildSession,
  getSession,
  getSessionMessages,
  listenToAgentSessionEvents,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type SessionEventAdapter,
  sessionMessageAt,
} from "./session-events-test-harness";

describe("agent-orchestrator session context usage and idle settlement", () => {
  test("updates live session context usage from step-finish part tokens", () => {
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
            variant: "high",
            profileId: "Hephaestus",
          },
          modelCatalog: {
            models: [
              {
                id: "openai/gpt-5",
                providerId: "openai",
                providerName: "OpenAI",
                modelId: "gpt-5",
                modelName: "GPT-5",
                variants: ["high"],
                contextWindow: 200_000,
                outputLimit: 8_192,
              },
            ],
            defaultModelsByProvider: { openai: "gpt-5" },
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

    listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      turnModelBySessionRef: {
        current: {
          "session-1": {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
            variant: "high",
            profileId: "Hephaestus",
          },
        },
      },
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
        kind: "step",
        messageId: "assistant-live-1",
        partId: "step-finish-1",
        phase: "finish",
        reason: "tool-calls",
        totalTokens: 35_022,
      },
    });

    expect(sessionsRef.current["session-1"]?.contextUsage).toEqual({
      totalTokens: 35_022,
      contextWindow: 200_000,
      outputLimit: 8_192,
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "Hephaestus",
    });
  });

  test("does not mark a step message as tokenized when the step update is ignored", () => {
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
        "session-1": buildSession(),
      },
    };
    const contextUsageMessageIdBySessionRef = { current: {} as Record<string, string> };

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

    listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      contextUsageMessageIdBySessionRef,
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
        kind: "step",
        messageId: "assistant-live-1",
        partId: "step-finish-1",
        phase: "finish",
        reason: "tool-calls",
        totalTokens: 0,
      },
    });

    expect(sessionsRef.current["session-1"]?.contextUsage).toBeNull();
    expect(contextUsageMessageIdBySessionRef.current["session-1"]).toBeUndefined();
  });

  test("keeps live context usage bound to the in-flight turn model after selection changes", () => {
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
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "anthropic",
            modelId: "claude-sonnet",
            profileId: "Hephaestus",
          },
          modelCatalog: {
            models: [
              {
                id: "openai/gpt-5",
                providerId: "openai",
                providerName: "OpenAI",
                modelId: "gpt-5",
                modelName: "GPT-5",
                variants: ["high"],
                contextWindow: 200_000,
                outputLimit: 8_192,
              },
              {
                id: "anthropic/claude-sonnet",
                providerId: "anthropic",
                providerName: "Anthropic",
                modelId: "claude-sonnet",
                modelName: "Claude Sonnet",
                variants: [],
                contextWindow: 100_000,
                outputLimit: 4_096,
              },
            ],
            defaultModelsByProvider: { openai: "gpt-5", anthropic: "claude-sonnet" },
          },
        }),
      },
    };

    const turnModelBySessionRef = {
      current: {
        "session-1": {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "Hephaestus",
        },
      } as Record<string, AgentSessionState["selectedModel"]>,
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

    listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      turnModelBySessionRef,
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
        kind: "step",
        messageId: "assistant-live-1",
        partId: "step-finish-1",
        phase: "finish",
        reason: "tool-calls",
        totalTokens: 35_022,
      },
    });

    expect(sessionsRef.current["session-1"]?.contextUsage).toEqual({
      totalTokens: 35_022,
      contextWindow: 200_000,
      outputLimit: 8_192,
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "Hephaestus",
    });
  });

  test("preserves step-derived context usage when the final assistant message omits token metadata", () => {
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
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
            variant: "high",
            profileId: "Hephaestus",
          },
          modelCatalog: {
            models: [
              {
                id: "openai/gpt-5",
                providerId: "openai",
                providerName: "OpenAI",
                modelId: "gpt-5",
                modelName: "GPT-5",
                variants: ["high"],
                contextWindow: 200_000,
                outputLimit: 8_192,
              },
            ],
            defaultModelsByProvider: { openai: "gpt-5" },
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

    listenToAgentSessionEvents({
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
      },
    });

    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "assistant-live-1",
      timestamp: "2026-02-22T08:00:03.000Z",
      message: "Final answer",
    });

    expect(sessionsRef.current["session-1"]?.contextUsage).toEqual({
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
      totalTokens: 35_022,
      contextWindow: 200_000,
      outputLimit: 8_192,
    });
  });

  test("preserves step-derived context usage even when no assistant transcript row exists yet", () => {
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
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
            variant: "high",
            profileId: "Hephaestus",
          },
          modelCatalog: {
            models: [
              {
                id: "openai/gpt-5",
                providerId: "openai",
                providerName: "OpenAI",
                modelId: "gpt-5",
                modelName: "GPT-5",
                variants: ["high"],
                contextWindow: 200_000,
                outputLimit: 8_192,
              },
            ],
            defaultModelsByProvider: { openai: "gpt-5" },
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

    listenToAgentSessionEvents({
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
        kind: "step",
        messageId: "assistant-live-1",
        partId: "step-finish-1",
        phase: "finish",
        reason: "tool-calls",
        totalTokens: 35_022,
      },
    });

    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "assistant-live-1",
      timestamp: "2026-02-22T08:00:03.000Z",
      message: "Final answer",
    });

    expect(sessionsRef.current["session-1"]?.contextUsage).toEqual({
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
      totalTokens: 35_022,
      contextWindow: 200_000,
      outputLimit: 8_192,
    });
  });

  test("does not carry previous-turn context usage into a new final snapshot without token updates", () => {
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
          modelCatalog: {
            models: [
              {
                id: "openai/gpt-5",
                providerId: "openai",
                providerName: "OpenAI",
                modelId: "gpt-5",
                modelName: "GPT-5",
                variants: ["high"],
                contextWindow: 200_000,
                outputLimit: 8_192,
              },
            ],
            defaultModelsByProvider: { openai: "gpt-5" },
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

    listenToAgentSessionEvents({
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

    expect(sessionsRef.current["session-1"]?.contextUsage).toBeNull();
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

  test("routes reasoning deltas into thinking draft state without finalizing assistant text", () => {
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

    listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
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
      type: "assistant_delta",
      externalSessionId: "session-1",
      channel: "reasoning",
      messageId: "assistant-message-reasoning",
      delta: "Reason silently",
      timestamp: "2026-02-22T08:00:02.000Z",
    });

    expect(sessionsRef.current["session-1"]?.draftAssistantText).toBe("");
    expect(sessionsRef.current["session-1"]?.draftReasoningText).toBe("Reason silently");

    handleEvent({
      type: "session_idle",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:03.000Z",
    });

    expect(sessionsRef.current["session-1"]?.draftReasoningText).toBe("");
    expect(
      getSessionMessages(sessionsRef).some(
        (message) => message.role === "assistant" && message.content.includes("Reason silently"),
      ),
    ).toBe(false);
  });

  test("keeps starting sessions active when an early idle event arrives before kickoff send", () => {
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
        "session-1": buildSession({ role: "build", status: "starting" }),
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

    listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
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
      type: "session_idle",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:03.000Z",
    });

    expect(sessionsRef.current["session-1"]?.status).toBe("starting");
  });

  test("keeps pending outbound sends running when early idle arrives before runtime activity", () => {
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
          role: "build",
          status: "running",
          pendingUserMessageStartedAt: 123,
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

    listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
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
      type: "session_idle",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:03.000Z",
    });

    expect(sessionsRef.current["session-1"]?.status).toBe("running");
    expect(sessionsRef.current["session-1"]?.pendingUserMessageStartedAt).toBe(123);
  });

  test("flushes buffered text drafts before terminal idle settlement", () => {
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

    listenToAgentSessionEvents({
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
      resolveTurnDurationMs: () => 120,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
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

    expect(sessionsRef.current["session-1"]?.draftAssistantText).toBe("");

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
    expect(sessionsRef.current["session-1"]?.draftAssistantText).toBe("");
  });

  test("upserts the finalized assistant message instead of appending a duplicate", () => {
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

    listenToAgentSessionEvents({
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
      resolveTurnDurationMs: () => 120,
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
