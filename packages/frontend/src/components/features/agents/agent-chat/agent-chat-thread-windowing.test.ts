import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { buildMessage, buildSession } from "./agent-chat-test-fixtures";
import {
  buildAgentChatWindowRowsState,
  buildAgentChatWindowRowsStateFromPrefix,
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
      pendingQuestions: [],
      status: "running",
    });

    const rows = buildAgentChatWindowRowsState(session, { showThinkingMessages: true }).rows;

    expect(rows).toEqual([]);
  });

  test("buildAgentChatWindowRowsStateFromPrefix preserves visible prefix rows while hiding appended thinking messages", () => {
    const previousSession = buildSession({
      externalSessionId: "session-prefix-hidden-append",
      messages: [
        buildMessage("user", "Question", { id: "user-1" }),
        buildMessage("thinking", "Hidden reasoning", { id: "thinking-1" }),
        buildMessage("assistant", "Answer", { id: "assistant-1" }),
      ],
    });
    const previousRowsState = buildAgentChatWindowRowsState(previousSession, {
      showThinkingMessages: false,
    });
    const prefixRow = previousRowsState.rows[0];
    const nextSession = buildSession({
      ...previousSession,
      messages: [
        ...previousSession.messages.items,
        buildMessage("thinking", "Still hidden", { id: "thinking-2" }),
        buildMessage("assistant", "Next answer", { id: "assistant-2" }),
      ],
    });

    const nextRowsState = buildAgentChatWindowRowsStateFromPrefix({
      session: nextSession,
      showThinkingMessages: false,
      previousRowsState,
      startMessageIndex: previousSession.messages.items.length,
      mode: "append",
    });

    expect(nextRowsState).not.toBeNull();
    if (!nextRowsState) {
      return;
    }
    expect(nextRowsState.rows[0]).toBe(prefixRow);
    expect(nextRowsState.rows.map((row) => row.key)).toEqual([
      `${agentSessionIdentityKey(nextSession)}:user-1`,
      `${agentSessionIdentityKey(nextSession)}:assistant-1:duration`,
      `${agentSessionIdentityKey(nextSession)}:assistant-1`,
      `${agentSessionIdentityKey(nextSession)}:assistant-2:duration`,
      `${agentSessionIdentityKey(nextSession)}:assistant-2`,
    ]);
    expect(
      nextRowsState.rows.some((row) => row.kind === "message" && row.message.role === "thinking"),
    ).toBe(false);
  });

  test("buildAgentChatWindowRowsStateFromPrefix replaces a tail after hidden thinking without duplicating rows", () => {
    const previousSession = buildSession({
      externalSessionId: "session-prefix-hidden-edit",
      status: "running",
      messages: [
        buildMessage("user", "Question", { id: "user-1" }),
        buildMessage("thinking", "Hidden reasoning", { id: "thinking-1" }),
        buildMessage("assistant", "Working", {
          id: "assistant-live",
          meta: { kind: "assistant", isFinal: false },
        }),
      ],
    });
    const previousRowsState = buildAgentChatWindowRowsState(previousSession, {
      showThinkingMessages: false,
    });
    const prefixRow = previousRowsState.rows[0];
    const nextSession = buildSession({
      ...previousSession,
      messages: [
        buildMessage("user", "Question", { id: "user-1" }),
        buildMessage("thinking", "Updated hidden reasoning", { id: "thinking-1" }),
        buildMessage("assistant", "Still working", {
          id: "assistant-live",
          meta: { kind: "assistant", isFinal: false },
        }),
      ],
    });

    const nextRowsState = buildAgentChatWindowRowsStateFromPrefix({
      session: nextSession,
      showThinkingMessages: false,
      previousRowsState,
      startMessageIndex: 1,
      mode: "replace-tail",
    });

    expect(nextRowsState).not.toBeNull();
    if (!nextRowsState) {
      return;
    }
    expect(nextRowsState.rows[0]).toBe(prefixRow);
    expect(nextRowsState.rows.map((row) => row.key)).toEqual([
      `${agentSessionIdentityKey(nextSession)}:user-1`,
      `${agentSessionIdentityKey(nextSession)}:assistant-live`,
    ]);
    expect(nextRowsState.activeStreamingAssistantMessageId).toBe("assistant-live");
    expect(
      nextRowsState.rows.some((row) => row.kind === "message" && row.message.role === "thinking"),
    ).toBe(false);
  });

  test("buildAgentChatWindowRowsStateFromPrefix returns null for ambiguous replace-tail anchors", () => {
    const previousSession = buildSession({
      externalSessionId: "session-prefix-ambiguous-tail",
      messages: [
        buildMessage("assistant", "Earlier duplicate", { id: "assistant-dup" }),
        buildMessage("user", "Question", { id: "user-1" }),
        buildMessage("assistant", "Tail duplicate", { id: "assistant-dup" }),
      ],
    });
    const previousRowsState = buildAgentChatWindowRowsState(previousSession, {
      showThinkingMessages: true,
    });
    const nextSession = buildSession({
      ...previousSession,
      messages: [
        ...previousSession.messages.items.slice(0, 2),
        buildMessage("assistant", "Updated duplicate", { id: "assistant-dup" }),
      ],
    });

    expect(
      buildAgentChatWindowRowsStateFromPrefix({
        session: nextSession,
        showThinkingMessages: true,
        previousRowsState,
        startMessageIndex: 2,
        mode: "replace-tail",
      }),
    ).toBeNull();
  });

  test("buildAgentChatWindowRowsStateFromPrefix returns null for missing replace-tail anchors", () => {
    const previousSession = buildSession({
      externalSessionId: "session-prefix-missing-tail",
      messages: [buildMessage("assistant", "Tail", { id: "assistant-tail" })],
    });
    const previousRowsState = buildAgentChatWindowRowsState(previousSession, {
      showThinkingMessages: true,
    });
    const nextSession = buildSession({
      ...previousSession,
      messages: [buildMessage("assistant", "Updated", { id: "assistant-missing" })],
    });

    expect(
      buildAgentChatWindowRowsStateFromPrefix({
        session: nextSession,
        showThinkingMessages: true,
        previousRowsState,
        startMessageIndex: 0,
        mode: "replace-tail",
      }),
    ).toBeNull();
  });

  test("buildAgentChatWindowRowsStateFromPrefix rebuilds metadata from retained rows after trimming", () => {
    const previousSession = buildSession({
      externalSessionId: "session-prefix-trimmed-metadata",
      messages: [
        buildMessage("assistant", "Prelude", { id: "assistant-0" }),
        buildMessage("user", "Attached tail", {
          id: "user-tail",
          meta: {
            kind: "user",
            state: "read",
            parts: [
              {
                kind: "attachment",
                attachment: {
                  id: "attachment-1",
                  kind: "pdf",
                  mime: "application/pdf",
                  name: "tail.pdf",
                  path: "/tmp/tail.pdf",
                },
              },
            ],
          },
        }),
        buildMessage("assistant", "Working", {
          id: "assistant-tail",
          meta: { kind: "assistant", isFinal: false },
        }),
      ],
    });
    const previousRowsState = buildAgentChatWindowRowsState(previousSession, {
      showThinkingMessages: true,
    });
    const nextSession = buildSession({
      ...previousSession,
      messages: [
        buildMessage("assistant", "Prelude", { id: "assistant-0" }),
        buildMessage("user", "Tail without attachment", {
          id: "user-tail",
          meta: { kind: "user", state: "read", parts: [] },
        }),
        buildMessage("assistant", "Still working", {
          id: "assistant-tail",
          meta: { kind: "assistant", isFinal: false },
        }),
      ],
    });

    const nextRowsState = buildAgentChatWindowRowsStateFromPrefix({
      session: nextSession,
      showThinkingMessages: true,
      previousRowsState,
      startMessageIndex: 1,
      mode: "replace-tail",
    });

    expect(nextRowsState?.hasAttachmentMessages).toBe(false);
    expect(nextRowsState?.lastUserMessageId).toBe("user-tail");
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
