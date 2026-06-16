import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { buildMessage, buildSession } from "./agent-chat-test-fixtures";
import {
  buildAgentChatWindowRowsState,
  buildAgentChatWindowTurns,
  CHAT_TURN_WINDOW_BATCH,
  CHAT_TURN_WINDOW_INIT,
} from "./agent-chat-thread-windowing";

describe("agent-chat-thread windowing helpers", () => {
  test("exports the turn window constants", () => {
    expect(CHAT_TURN_WINDOW_INIT).toBe(10);
    expect(CHAT_TURN_WINDOW_BATCH).toBe(8);
  });

  test("buildAgentChatWindowRowsState keeps message order without synthetic draft rows", () => {
    const session = buildSession({
      messages: [
        buildMessage("assistant", "Done", {
          id: "assistant-1",
          meta: {
            kind: "assistant",
            agentRole: "spec",
            isFinal: true,
            profileId: "Hephaestus (Deep Agent)",
            durationMs: 1_500,
          },
        }),
        buildMessage("user", "Follow-up", { id: "user-1" }),
      ],
      pendingQuestions: [],
    });
    const sessionKey = agentSessionIdentityKey(session);

    const rows = buildAgentChatWindowRowsState(session, { showThinkingMessages: true }).rows;

    expect(rows.map((row) => row.key)).toEqual([
      `${sessionKey}:assistant-1:duration`,
      `${sessionKey}:assistant-1`,
      `${sessionKey}:user-1`,
    ]);
    expect(rows.map((row) => row.kind)).toEqual(["turn_duration", "message", "message"]);
  });

  test("buildAgentChatWindowTurns groups transcript rows by user turns", () => {
    const session = buildSession({
      messages: [
        buildMessage("assistant", "Prelude", { id: "assistant-0" }),
        buildMessage("user", "Question 1", { id: "user-1" }),
        buildMessage("assistant", "Answer 1", { id: "assistant-1" }),
        buildMessage("user", "Question 2", { id: "user-2" }),
        buildMessage("assistant", "Answer 2", { id: "assistant-2" }),
      ],
      pendingQuestions: [],
    });
    const sessionKey = agentSessionIdentityKey(session);

    const rows = buildAgentChatWindowRowsState(session, { showThinkingMessages: true }).rows;
    const turns = buildAgentChatWindowTurns(rows);

    expect(turns).toEqual([
      {
        key: `${sessionKey}:assistant-0:duration`,
        start: 0,
        end: 1,
      },
      {
        key: `${sessionKey}:user-1`,
        start: 2,
        end: 4,
      },
      {
        key: `${sessionKey}:user-2`,
        start: 5,
        end: 7,
      },
    ]);
  });

  test("buildAgentChatWindowRowsState keeps row keys distinct across sessions with repeated message ids", () => {
    const firstSession = buildSession({
      runtimeKind: "opencode",
      externalSessionId: "session-a",
      messages: [buildMessage("assistant", "A", { id: "message-1" })],
      pendingQuestions: [],
    });
    const secondSession = buildSession({
      runtimeKind: "opencode",
      externalSessionId: "session-b",
      messages: [buildMessage("assistant", "B", { id: "message-1" })],
      pendingQuestions: [],
    });

    const firstKeys = buildAgentChatWindowRowsState(firstSession, {
      showThinkingMessages: true,
    }).rows.map((row) => row.key);
    const secondKeys = buildAgentChatWindowRowsState(secondSession, {
      showThinkingMessages: true,
    }).rows.map((row) => row.key);
    const firstSessionKey = agentSessionIdentityKey(firstSession);
    const secondSessionKey = agentSessionIdentityKey(secondSession);

    expect(firstKeys).toContain(`${firstSessionKey}:message-1`);
    expect(secondKeys).toContain(`${secondSessionKey}:message-1`);
    expect(firstKeys).not.toContain(`${secondSessionKey}:message-1`);
  });

  test("buildAgentChatWindowRowsState omits reasoning rows when showThinkingMessages is false", () => {
    const session = buildSession({
      messages: [
        buildMessage("user", "Question", { id: "user-1" }),
        buildMessage("thinking", "Reasoning", { id: "thinking-1" }),
        buildMessage("assistant", "Answer", { id: "assistant-1" }),
      ],
      pendingQuestions: [],
    });
    const sessionKey = agentSessionIdentityKey(session);

    const visibleRows = buildAgentChatWindowRowsState(session, {
      showThinkingMessages: true,
    }).rows;
    const hiddenRows = buildAgentChatWindowRowsState(session, {
      showThinkingMessages: false,
    }).rows;

    expect(visibleRows.map((row) => row.key)).toEqual([
      `${sessionKey}:user-1`,
      `${sessionKey}:thinking-1`,
      `${sessionKey}:assistant-1:duration`,
      `${sessionKey}:assistant-1`,
    ]);
    expect(hiddenRows.map((row) => row.key)).toEqual([
      `${sessionKey}:user-1`,
      `${sessionKey}:assistant-1:duration`,
      `${sessionKey}:assistant-1`,
    ]);
    expect(
      hiddenRows.some((row) => row.kind === "message" && row.message.role === "thinking"),
    ).toBe(false);
  });

  test("buildAgentChatWindowRowsState does not append synthetic thinking rows", () => {
    const session = buildSession({
      messages: [],
      draftAssistantText: "",
      pendingQuestions: [],
      status: "running",
    });

    const rows = buildAgentChatWindowRowsState(session, { showThinkingMessages: true }).rows;

    expect(rows).toEqual([]);
  });

  test("buildAgentChatWindowRowsState skips turn duration rows for non-final assistant messages", () => {
    const session = buildSession({
      messages: [
        buildMessage("assistant", "Working", {
          id: "assistant-live",
          meta: {
            kind: "assistant",
            agentRole: "spec",
            isFinal: false,
            profileId: "Hephaestus (Deep Agent)",
            durationMs: 1_500,
          },
        }),
      ],
      pendingQuestions: [],
    });
    const sessionKey = agentSessionIdentityKey(session);

    const rows = buildAgentChatWindowRowsState(session, { showThinkingMessages: true }).rows;

    expect(rows.map((row) => row.kind)).toEqual(["message"]);
    expect(rows[0]?.key).toBe(`${sessionKey}:assistant-live`);
  });

  test("buildAgentChatWindowRowsState marks active streaming assistant only while session activity is running", () => {
    const sharedMessages = [
      buildMessage("assistant", "Working", {
        id: "assistant-live",
        meta: {
          kind: "assistant",
          agentRole: "build",
          isFinal: false,
          profileId: "Hephaestus (Deep Agent)",
        },
      }),
    ];
    const runningSession = buildSession({
      externalSessionId: "session-status",
      role: "build",
      status: "running",
      messages: sharedMessages,
    });
    const idleSession = buildSession({
      ...runningSession,
      status: "idle",
    });

    const runningRowsState = buildAgentChatWindowRowsState(runningSession, {
      showThinkingMessages: true,
    });
    const idleRowsState = buildAgentChatWindowRowsState(idleSession, {
      showThinkingMessages: true,
    });

    expect(runningRowsState.activeStreamingAssistantMessageId).toBe("assistant-live");
    expect(idleRowsState.activeStreamingAssistantMessageId).toBeNull();
  });

  test("buildAgentChatWindowRowsState restores streaming metadata when session activity resumes", () => {
    const sharedMessages = [
      buildMessage("assistant", "Working", {
        id: "assistant-live",
        meta: {
          kind: "assistant",
          agentRole: "build",
          isFinal: false,
          profileId: "Hephaestus (Deep Agent)",
        },
      }),
    ];
    const idleSession = buildSession({
      externalSessionId: "session-resume",
      role: "build",
      status: "idle",
      messages: sharedMessages,
    });
    const resumedSession = buildSession({
      ...idleSession,
      status: "running",
    });

    const idleRowsState = buildAgentChatWindowRowsState(idleSession, {
      showThinkingMessages: true,
    });
    const resumedRowsState = buildAgentChatWindowRowsState(resumedSession, {
      showThinkingMessages: true,
    });

    expect(idleRowsState.activeStreamingAssistantMessageId).toBeNull();
    expect(resumedRowsState.activeStreamingAssistantMessageId).toBe("assistant-live");
  });
});
