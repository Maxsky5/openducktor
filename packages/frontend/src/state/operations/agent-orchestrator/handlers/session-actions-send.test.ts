import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import { MANUAL_SESSION_COMPACTION_SLASH_COMMAND } from "@openducktor/contracts";
import type { AcceptedAgentUserMessage, SendAgentUserMessageInput } from "@openducktor/core";
import { serializeAgentUserMessagePartsToText } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { getAgentSession, replaceAgentSession } from "@/state/agent-session-collection";
import {
  findSessionMessageForTest,
  sessionMessagesToArray,
} from "@/test-utils/session-message-test-helpers";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  createSessionUpdater as createEventSessionUpdater,
  listenToAgentSessionEvents,
} from "../events/session-events-test-harness";
import { createTaskCardFixture } from "../test-utils";
import {
  buildSession,
  createSessionActions,
  createSessionsRef,
  createSessionTurnStateFixture,
  getSession,
} from "./session-actions.test-helpers";

const acceptedUserMessage = (
  input: SendAgentUserMessageInput,
  messageId = "accepted-user-message",
): AcceptedAgentUserMessage => ({
  type: "user_message",
  externalSessionId: input.externalSessionId,
  timestamp: "2026-02-22T08:00:01.000Z",
  messageId,
  message: serializeAgentUserMessagePartsToText(input.parts),
  parts: [],
  state: "read",
  ...(input.model ? { model: input.model } : {}),
});

describe("agent-orchestrator/handlers/session-actions send", () => {
  test("routes a normalized workflow control without loading runtime policy settings", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendInput: unknown;
    adapter.sendUserMessage = async (input) => {
      sendInput = input;
      return acceptedUserMessage(input);
    };
    const sessionsRef = createSessionsRef([
      buildSession({
        status: "idle",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
        },
      }),
    ]);
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      ensureExistingSessionRuntime: async () => {},
      loadSettingsSnapshot: async () => {
        throw new Error("session control must not load runtime policy settings");
      },
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]);

      expect(sendInput).toMatchObject({
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        externalSessionId: "session-1",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      });
      expect(sendInput).not.toHaveProperty("runtimePolicy");
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("does not store the Codex compaction send result as a user message", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    adapter.sendUserMessage = async (input) => acceptedUserMessage(input);
    const sessionsRef = createSessionsRef([
      buildSession({
        runtimeKind: "codex",
        status: "idle",
        selectedModel: {
          runtimeKind: "codex",
          providerId: "openai",
          modelId: "gpt-5.3-codex",
          variant: "high",
        },
      }),
    ]);
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      ensureExistingSessionRuntime: async () => {},
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [
        { kind: "slash_command", command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND },
      ]);

      expect(
        sessionMessagesToArray(getSession(sessionsRef)).some((message) => message.role === "user"),
      ).toBe(false);
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("does not store the OpenCode compaction send result as a user message", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    adapter.sendUserMessage = async (input) => acceptedUserMessage(input);
    const sessionsRef = createSessionsRef([
      buildSession({
        runtimeKind: "opencode",
        status: "idle",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5.3-codex",
          variant: "high",
        },
      }),
    ]);
    const actions = createSessionActions({ adapter, sessionsRef });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [
        { kind: "slash_command", command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND },
      ]);

      expect(
        sessionMessagesToArray(getSession(sessionsRef)).some((message) => message.role === "user"),
      ).toBe(false);
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("stores accepted user messages from the runtime send result", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    adapter.readSessionRuntimeSnapshot = async () => {
      throw new Error("send must not probe runtime snapshots");
    };
    adapter.sendUserMessage = async (input) => {
      sendCalls += 1;
      expect(input.systemPrompt).toContain("Implement the task");
      return acceptedUserMessage(input);
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "idle",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5.3-codex",
          variant: "high",
          profileId: "Hephaestus (Deep Agent)",
        },
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      ensureExistingSessionRuntime: async () => {},
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]);
      expect(sendCalls).toBe(1);
      expect(getSession(sessionsRef)?.status).toBe("running");
      expect(sessionMessagesToArray(getSession(sessionsRef))).toEqual([
        expect.objectContaining({
          id: "accepted-user-message",
          role: "user",
          content: "hello",
        }),
      ]);
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("stores a live accepted user message only once when send returns the same event", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    const originalSubscribeEvents = adapter.subscribeEvents;
    const handlers: Parameters<typeof adapter.subscribeEvents>[1][] = [];
    adapter.subscribeEvents = async (_sessionRef, handler) => {
      handlers.push(handler);
      return () => {};
    };
    adapter.sendUserMessage = async (input) => {
      const event = acceptedUserMessage(input);
      for (const handler of handlers) {
        handler(event);
      }
      return event;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "idle",
        historyLoadState: "loaded",
      }),
    ]);

    const unsubscribe = await listenToAgentSessionEvents({
      adapter,
      sessionsRef,
      updateSession: createEventSessionUpdater(sessionsRef),
      externalSessionId: "session-1",
      repoPath: "/tmp/repo",
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
    });
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      ensureExistingSessionRuntime: async () => {},
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]);

      const userMessages = sessionMessagesToArray(getSession(sessionsRef)).filter(
        (message) => message.role === "user",
      );
      expect(userMessages).toHaveLength(1);
      expect(userMessages[0]).toEqual(
        expect.objectContaining({
          id: "accepted-user-message",
          role: "user",
          content: "hello",
        }),
      );
    } finally {
      unsubscribe();
      adapter.sendUserMessage = originalSendUserMessage;
      adapter.subscribeEvents = originalSubscribeEvents;
    }
  });

  test("stores a live accepted user message only once when send returns an equivalent event", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    const originalSubscribeEvents = adapter.subscribeEvents;
    const handlers: Parameters<typeof adapter.subscribeEvents>[1][] = [];
    adapter.subscribeEvents = async (_sessionRef, handler) => {
      handlers.push(handler);
      return () => {};
    };
    adapter.sendUserMessage = async (input) => {
      const event = acceptedUserMessage(input);
      for (const handler of handlers) {
        handler({
          ...event,
          messageId: "live-user-message",
        });
      }
      return event;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "idle",
        historyLoadState: "loaded",
      }),
    ]);

    const unsubscribe = await listenToAgentSessionEvents({
      adapter,
      sessionsRef,
      updateSession: createEventSessionUpdater(sessionsRef),
      externalSessionId: "session-1",
      repoPath: "/tmp/repo",
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
    });
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      ensureExistingSessionRuntime: async () => {},
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]);

      const userMessages = sessionMessagesToArray(getSession(sessionsRef)).filter(
        (message) => message.role === "user",
      );
      expect(userMessages).toHaveLength(1);
      expect(userMessages[0]).toEqual(
        expect.objectContaining({
          id: "accepted-user-message",
          role: "user",
          content: "hello",
        }),
      );
    } finally {
      unsubscribe();
      adapter.sendUserMessage = originalSendUserMessage;
      adapter.subscribeEvents = originalSubscribeEvents;
    }
  });

  test("stores a Codex accepted user message only once when runtime confirmation has a nearby timestamp", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    const originalSubscribeEvents = adapter.subscribeEvents;
    const handlers: Parameters<typeof adapter.subscribeEvents>[1][] = [];
    const acceptedCodexEvents: AcceptedAgentUserMessage[] = [];
    adapter.subscribeEvents = async (_sessionRef, handler) => {
      handlers.push(handler);
      return () => {};
    };
    adapter.sendUserMessage = async (input) => {
      const event = {
        ...acceptedUserMessage(input, "codex-user-1772355601000-1"),
        timestamp: "2026-02-22T08:00:01.000Z",
      };
      acceptedCodexEvents.push(event);
      for (const handler of handlers) {
        handler(event);
      }
      return event;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "idle",
        historyLoadState: "loaded",
      }),
    ]);

    const unsubscribe = await listenToAgentSessionEvents({
      adapter,
      sessionsRef,
      updateSession: createEventSessionUpdater(sessionsRef),
      externalSessionId: "session-1",
      repoPath: "/tmp/repo",
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
    });
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      ensureExistingSessionRuntime: async () => {},
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]);
      const confirmedEvent = acceptedCodexEvents[0];
      if (!confirmedEvent) {
        throw new Error("Expected fake adapter to accept the Codex user message.");
      }
      for (const handler of handlers) {
        handler({
          type: confirmedEvent.type,
          externalSessionId: confirmedEvent.externalSessionId,
          messageId: "runtime-user-confirmed",
          message: confirmedEvent.message,
          parts: confirmedEvent.parts,
          state: confirmedEvent.state,
          timestamp: "2026-02-22T08:00:06.000Z",
          ...(confirmedEvent.model ? { model: confirmedEvent.model } : {}),
        });
      }

      const userMessages = sessionMessagesToArray(getSession(sessionsRef)).filter(
        (message) => message.role === "user",
      );
      expect(userMessages).toHaveLength(1);
      expect(userMessages[0]).toEqual(
        expect.objectContaining({
          id: "runtime-user-confirmed",
          role: "user",
          content: "hello",
          timestamp: "2026-02-22T08:00:06.000Z",
        }),
      );
    } finally {
      unsubscribe();
      adapter.sendUserMessage = originalSendUserMessage;
      adapter.subscribeEvents = originalSubscribeEvents;
    }
  });

  test("releases held starting sessions to running when sending starts", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    const committedStatuses: AgentSessionState["status"][] = [];
    adapter.sendUserMessage = async (input) => {
      sendCalls += 1;
      return acceptedUserMessage(input);
    };

    const sessionsRef = createSessionsRef([buildSession({ status: "starting" })]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      updateSession: (identity, updater) => {
        const current = getAgentSession(sessionsRef.current, identity);
        if (!current) {
          return null;
        }
        const next = updater(current);
        if (current.status === "starting") {
          expect(next.status).not.toBe("idle");
        }
        committedStatuses.push(next.status);
        sessionsRef.current = replaceAgentSession(sessionsRef.current, next);
        return next;
      },
      ensureExistingSessionRuntime: async () => {},
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]);

      expect(sendCalls).toBe(1);
      expect(committedStatuses).not.toContain("idle");
      expect(getSession(sessionsRef)?.status).toBe("running");
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("releases held starting sessions to idle when pending input prevents sending", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    adapter.sendUserMessage = async (input) => {
      sendCalls += 1;
      return acceptedUserMessage(input);
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "starting",
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [{ header: "Confirm", question: "Confirm", options: [] }],
          },
        ],
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      ensureExistingSessionRuntime: async () => {
        throw new Error("runtime unavailable");
      },
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]);

      expect(sendCalls).toBe(0);
      expect(getSession(sessionsRef)?.status).toBe("idle");
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("marks held starting sessions as failed when send preparation fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    adapter.sendUserMessage = async (input) => {
      sendCalls += 1;
      return acceptedUserMessage(input);
    };

    const sessionsRef = createSessionsRef([buildSession({ status: "starting" })]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      ensureExistingSessionRuntime: async () => {
        throw new Error("runtime unavailable");
      },
    });

    try {
      await expect(
        actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]),
      ).rejects.toThrow("runtime unavailable");

      expect(sendCalls).toBe(0);
      expect(getSession(sessionsRef)?.status).toBe("error");
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("does not load requested history before sending to a runtime session", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    const callOrder: string[] = [];
    adapter.sendUserMessage = async (input) => {
      callOrder.push("send");
      return acceptedUserMessage(input);
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "idle",
        historyLoadState: "not_requested",
        messages: [],
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      ensureExistingSessionRuntime: async () => {},
      loadSourceSession: async () => {
        callOrder.push("load");
        return null;
      },
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]);

      expect(callOrder).toEqual(["send"]);
      expect(sessionMessagesToArray(getSession(sessionsRef))).toEqual([
        expect.objectContaining({
          role: "user",
          content: "hello",
        }),
      ]);
      expect(getSession(sessionsRef)?.historyLoadState).toBe("not_requested");
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("does not send free-form messages while waiting for pending input", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    adapter.sendUserMessage = async (input) => {
      sendCalls += 1;
      return acceptedUserMessage(input);
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "idle",
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [{ header: "Confirm", question: "Confirm", options: [] }],
          },
        ],
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      ensureExistingSessionRuntime: async () => {},
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: " hello " }]);
      expect(sendCalls).toBe(0);
      expect(sessionMessagesToArray(getSession(sessionsRef))).toHaveLength(0);
      expect(getSession(sessionsRef)?.pendingQuestions).toHaveLength(1);
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("rejects send when role is unavailable for the current task", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    adapter.sendUserMessage = async (input) => {
      sendCalls += 1;
      return acceptedUserMessage(input);
    };

    const sessionsRef = createSessionsRef([
      buildSession({ status: "idle", role: "build", taskId: "task-1" }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: {
        current: [
          createTaskCardFixture({
            id: "task-1",
            status: "open",
            agentWorkflows: {
              spec: { required: true, canSkip: false, available: true, completed: false },
              planner: { required: true, canSkip: false, available: false, completed: false },
              builder: { required: true, canSkip: false, available: false, completed: false },
              qa: { required: true, canSkip: false, available: false, completed: false },
            },
          }),
        ],
      },
      ensureExistingSessionRuntime: async () => {},
    });

    try {
      await expect(
        actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]),
      ).rejects.toThrow("Role 'build' is unavailable for task 'task-1' in status 'open'.");
      expect(sendCalls).toBe(0);
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("marks session as error when send fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    adapter.sendUserMessage = async () => {
      throw new Error("send failed");
    };

    const sessionsRef = createSessionsRef([buildSession({ status: "idle" })]);
    const sessionKey = agentSessionIdentityKey(getSession(sessionsRef));
    const sessionTurnState = createSessionTurnStateFixture();
    sessionTurnState.assistantTurnTiming.recordTurnUserMessageTimestamp(sessionKey, 1);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      ensureExistingSessionRuntime: async () => {},
      sessionTurnState: sessionTurnState.sessionTurnState,
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]);
      expect(getSession(sessionsRef)?.status).toBe("error");
      const failureMessage = findSessionMessageForTest(getSession(sessionsRef), (message) =>
        message.content.includes("Failed to send message:"),
      );
      expect(failureMessage?.content).toContain("Failed to send message:");
      expect(failureMessage?.meta).toEqual({
        kind: "session_notice",
        tone: "error",
        reason: "session_error",
        title: "Error",
      });
      expect(
        sessionTurnState.assistantTurnTiming.readTurnUserMessageStartedAtMs(sessionKey),
      ).toBeUndefined();
      expect(sessionTurnState.turnMetadata.readModel(sessionKey)).toBeUndefined();
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("preserves active turn transcript and timing for busy queued sends", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    const sendCalls: Array<{
      externalSessionId: string;
      parts: { kind: string; text?: string }[];
    }> = [];
    adapter.sendUserMessage = async (input) => {
      sendCalls.push({
        externalSessionId: input.externalSessionId,
        parts: input.parts.map((part) =>
          part.kind === "text" ? { kind: part.kind, text: part.text } : { kind: part.kind },
        ),
      });
      return acceptedUserMessage(input);
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "running",
      }),
    ]);
    const messagesBeforeSend = getSession(sessionsRef).messages;
    let recordUserAnchorCalls = 0;
    const sessionKey = agentSessionIdentityKey(getSession(sessionsRef));
    const sessionTurnState = createSessionTurnStateFixture();
    sessionTurnState.turnMetadata.recordModel(sessionKey, {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
    });

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionTurnState: {
        ...sessionTurnState.sessionTurnState,
        timing: {
          ...sessionTurnState.sessionTurnState.timing,
          recordTurnUserMessageTimestamp: () => {
            recordUserAnchorCalls += 1;
            return 1234;
          },
          readTurnUserMessageStartedAtMs: () => 1234,
        },
      },
      ensureExistingSessionRuntime: async () => {
        throw new Error("running sessions must send without preparation");
      },
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [
        { kind: "text", text: "queued follow-up" },
      ]);

      expect(sendCalls).toEqual([
        { externalSessionId: "session-1", parts: [{ kind: "text", text: "queued follow-up" }] },
      ]);
      expect(sessionMessagesToArray(getSession(sessionsRef))).toEqual([
        ...sessionMessagesToArray({ externalSessionId: "session-1", messages: messagesBeforeSend }),
        expect.objectContaining({
          role: "user",
          content: "queued follow-up",
        }),
      ]);
      expect(recordUserAnchorCalls).toBe(0);
      expect(sessionTurnState.turnMetadata.readModel(sessionKey)?.modelId).toBe("gpt-5");
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("keeps the active turn running when a busy queued send fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    adapter.sendUserMessage = async () => {
      throw new Error("queued send failed");
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "running",
      }),
    ]);
    const messagesBeforeSend = getSession(sessionsRef).messages;
    let recordUserAnchorCalls = 0;
    const sessionKey = agentSessionIdentityKey(getSession(sessionsRef));
    const sessionTurnState = createSessionTurnStateFixture();
    sessionTurnState.turnMetadata.recordModel(sessionKey, {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
    });

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionTurnState: {
        ...sessionTurnState.sessionTurnState,
        timing: {
          ...sessionTurnState.sessionTurnState.timing,
          recordTurnUserMessageTimestamp: () => {
            recordUserAnchorCalls += 1;
            return 1234;
          },
          readTurnUserMessageStartedAtMs: () => 1234,
        },
      },
      ensureExistingSessionRuntime: async () => {
        throw new Error("running sessions must send without preparation");
      },
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [
        { kind: "text", text: "queued follow-up" },
      ]);

      expect(getSession(sessionsRef)?.status).toBe("running");
      expect(sessionMessagesToArray(getSession(sessionsRef))).toEqual([
        ...sessionMessagesToArray({ externalSessionId: "session-1", messages: messagesBeforeSend }),
        expect.objectContaining({
          content: expect.stringContaining("Failed to send message:"),
        }),
      ]);
      const failureMessage = findSessionMessageForTest(getSession(sessionsRef), (message) =>
        message.content.includes("Failed to send message:"),
      );
      expect(failureMessage?.content).toContain("Failed to send message:");
      expect(failureMessage?.meta).toEqual({
        kind: "session_notice",
        tone: "error",
        reason: "session_error",
        title: "Error",
      });
      expect(recordUserAnchorCalls).toBe(0);
      expect(sessionTurnState.turnMetadata.readModel(sessionKey)?.modelId).toBe("gpt-5");
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });
});
