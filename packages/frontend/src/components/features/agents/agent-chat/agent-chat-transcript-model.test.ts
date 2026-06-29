import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { buildMessage, buildSession } from "./agent-chat-test-fixtures";
import {
  buildAgentChatTranscriptModel,
  buildAgentChatTurnAnchors,
  updateAgentChatTranscriptModelFromPrefix,
} from "./agent-chat-transcript-model";

describe("agent chat transcript model", () => {
  test("buildAgentChatTranscriptModel keeps message order without synthetic draft rows", () => {
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

    const rows = buildAgentChatTranscriptModel(session, { showThinkingMessages: true }).rows;

    expect(rows.map((row) => row.key)).toEqual([
      `${sessionKey}:0:assistant-1:duration`,
      `${sessionKey}:0:assistant-1`,
      `${sessionKey}:1:user-1`,
    ]);
    expect(rows.map((row) => row.kind)).toEqual(["turn_duration", "message", "message"]);
  });

  test("buildAgentChatTurnAnchors groups transcript rows by user turns", () => {
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

    const rows = buildAgentChatTranscriptModel(session, { showThinkingMessages: true }).rows;
    const turnAnchors = buildAgentChatTurnAnchors(rows);

    expect(turnAnchors).toEqual([
      {
        key: `${sessionKey}:0:assistant-0:duration`,
        startRow: 0,
        endRowExclusive: 2,
      },
      {
        key: `${sessionKey}:1:user-1`,
        startRow: 2,
        endRowExclusive: 5,
      },
      {
        key: `${sessionKey}:3:user-2`,
        startRow: 5,
        endRowExclusive: 8,
      },
    ]);
  });

  test("buildAgentChatTranscriptModel keeps row keys distinct across sessions with repeated message ids", () => {
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

    const firstKeys = buildAgentChatTranscriptModel(firstSession, {
      showThinkingMessages: true,
    }).rows.map((row) => row.key);
    const secondKeys = buildAgentChatTranscriptModel(secondSession, {
      showThinkingMessages: true,
    }).rows.map((row) => row.key);
    const firstSessionKey = agentSessionIdentityKey(firstSession);
    const secondSessionKey = agentSessionIdentityKey(secondSession);

    expect(firstKeys).toContain(`${firstSessionKey}:0:message-1`);
    expect(secondKeys).toContain(`${secondSessionKey}:0:message-1`);
    expect(firstKeys).not.toContain(`${secondSessionKey}:0:message-1`);
  });

  test("buildAgentChatTranscriptModel keeps same-session duplicate message ids distinct", () => {
    const session = buildSession({
      messages: [
        buildMessage("user", "First", { id: "message-1" }),
        buildMessage("user", "Second", { id: "message-1" }),
      ],
      pendingQuestions: [],
    });
    const sessionKey = agentSessionIdentityKey(session);

    const model = buildAgentChatTranscriptModel(session, { showThinkingMessages: true });

    expect(model.rows.map((row) => row.key)).toEqual([
      `${sessionKey}:0:message-1`,
      `${sessionKey}:1:message-1`,
    ]);
    expect(new Set(model.rows.map((row) => row.key)).size).toBe(model.rows.length);
    expect(model.turnAnchors.map((turn) => turn.key)).toEqual([
      `${sessionKey}:0:message-1`,
      `${sessionKey}:1:message-1`,
    ]);
  });

  test("buildAgentChatTranscriptModel omits reasoning rows when showThinkingMessages is false", () => {
    const session = buildSession({
      messages: [
        buildMessage("user", "Question", { id: "user-1" }),
        buildMessage("thinking", "Reasoning", { id: "thinking-1" }),
        buildMessage("assistant", "Answer", { id: "assistant-1" }),
      ],
      pendingQuestions: [],
    });
    const sessionKey = agentSessionIdentityKey(session);

    const visibleRows = buildAgentChatTranscriptModel(session, {
      showThinkingMessages: true,
    }).rows;
    const hiddenRows = buildAgentChatTranscriptModel(session, {
      showThinkingMessages: false,
    }).rows;

    expect(visibleRows.map((row) => row.key)).toEqual([
      `${sessionKey}:0:user-1`,
      `${sessionKey}:1:thinking-1`,
      `${sessionKey}:2:assistant-1:duration`,
      `${sessionKey}:2:assistant-1`,
    ]);
    expect(hiddenRows.map((row) => row.key)).toEqual([
      `${sessionKey}:0:user-1`,
      `${sessionKey}:2:assistant-1:duration`,
      `${sessionKey}:2:assistant-1`,
    ]);
    expect(
      hiddenRows.some((row) => row.kind === "message" && row.message.role === "thinking"),
    ).toBe(false);
  });

  test("buildAgentChatTranscriptModel does not append synthetic thinking rows", () => {
    const session = buildSession({
      messages: [],
      pendingQuestions: [],
      status: "running",
    });

    const rows = buildAgentChatTranscriptModel(session, { showThinkingMessages: true }).rows;

    expect(rows).toEqual([]);
  });

  test("updateAgentChatTranscriptModelFromPrefix preserves visible prefix rows while hiding appended thinking messages", () => {
    const previousSession = buildSession({
      externalSessionId: "session-prefix-hidden-append",
      messages: [
        buildMessage("user", "Question", { id: "user-1" }),
        buildMessage("thinking", "Hidden reasoning", { id: "thinking-1" }),
        buildMessage("assistant", "Answer", { id: "assistant-1" }),
      ],
    });
    const previousTranscriptModel = buildAgentChatTranscriptModel(previousSession, {
      showThinkingMessages: false,
    });
    const prefixRow = previousTranscriptModel.rows[0];
    const nextSession = buildSession({
      ...previousSession,
      messages: [
        ...previousSession.messages.items,
        buildMessage("thinking", "Still hidden", { id: "thinking-2" }),
        buildMessage("assistant", "Next answer", { id: "assistant-2" }),
      ],
    });

    const nextTranscriptModel = updateAgentChatTranscriptModelFromPrefix({
      session: nextSession,
      showThinkingMessages: false,
      previousTranscriptModel,
      startMessageIndex: previousSession.messages.items.length,
      mode: "append",
    });

    expect(nextTranscriptModel).not.toBeNull();
    if (!nextTranscriptModel) {
      return;
    }
    expect(nextTranscriptModel.rows[0]).toBe(prefixRow);
    expect(nextTranscriptModel.rows.map((row) => row.key)).toEqual([
      `${agentSessionIdentityKey(nextSession)}:0:user-1`,
      `${agentSessionIdentityKey(nextSession)}:2:assistant-1:duration`,
      `${agentSessionIdentityKey(nextSession)}:2:assistant-1`,
      `${agentSessionIdentityKey(nextSession)}:4:assistant-2:duration`,
      `${agentSessionIdentityKey(nextSession)}:4:assistant-2`,
    ]);
    expect(
      nextTranscriptModel.rows.some(
        (row) => row.kind === "message" && row.message.role === "thinking",
      ),
    ).toBe(false);
  });

  test("updateAgentChatTranscriptModelFromPrefix replaces a tail after hidden thinking without duplicating rows", () => {
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
    const previousTranscriptModel = buildAgentChatTranscriptModel(previousSession, {
      showThinkingMessages: false,
    });
    const prefixRow = previousTranscriptModel.rows[0];
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

    const nextTranscriptModel = updateAgentChatTranscriptModelFromPrefix({
      session: nextSession,
      showThinkingMessages: false,
      previousTranscriptModel,
      startMessageIndex: 1,
      mode: "replace-tail",
    });

    expect(nextTranscriptModel).not.toBeNull();
    if (!nextTranscriptModel) {
      return;
    }
    expect(nextTranscriptModel.rows[0]).toBe(prefixRow);
    expect(nextTranscriptModel.rows.map((row) => row.key)).toEqual([
      `${agentSessionIdentityKey(nextSession)}:0:user-1`,
      `${agentSessionIdentityKey(nextSession)}:2:assistant-live`,
    ]);
    expect(nextTranscriptModel.activeStreamingAssistantMessageId).toBe("assistant-live");
    expect(
      nextTranscriptModel.rows.some(
        (row) => row.kind === "message" && row.message.role === "thinking",
      ),
    ).toBe(false);
  });

  test("updateAgentChatTranscriptModelFromPrefix returns null for ambiguous replace-tail anchors", () => {
    const previousSession = buildSession({
      externalSessionId: "session-prefix-ambiguous-tail",
      messages: [
        buildMessage("assistant", "Earlier duplicate", { id: "assistant-dup" }),
        buildMessage("user", "Question", { id: "user-1" }),
        buildMessage("assistant", "Tail duplicate", { id: "assistant-dup" }),
      ],
    });
    const previousTranscriptModel = buildAgentChatTranscriptModel(previousSession, {
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
      updateAgentChatTranscriptModelFromPrefix({
        session: nextSession,
        showThinkingMessages: true,
        previousTranscriptModel,
        startMessageIndex: 2,
        mode: "replace-tail",
      }),
    ).toBeNull();
  });

  test("updateAgentChatTranscriptModelFromPrefix returns null for missing replace-tail anchors", () => {
    const previousSession = buildSession({
      externalSessionId: "session-prefix-missing-tail",
      messages: [buildMessage("assistant", "Tail", { id: "assistant-tail" })],
    });
    const previousTranscriptModel = buildAgentChatTranscriptModel(previousSession, {
      showThinkingMessages: true,
    });
    const nextSession = buildSession({
      ...previousSession,
      messages: [buildMessage("assistant", "Updated", { id: "assistant-missing" })],
    });

    expect(
      updateAgentChatTranscriptModelFromPrefix({
        session: nextSession,
        showThinkingMessages: true,
        previousTranscriptModel,
        startMessageIndex: 0,
        mode: "replace-tail",
      }),
    ).toBeNull();
  });

  test("updateAgentChatTranscriptModelFromPrefix rebuilds metadata from retained rows after trimming", () => {
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
    const previousTranscriptModel = buildAgentChatTranscriptModel(previousSession, {
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

    const nextTranscriptModel = updateAgentChatTranscriptModelFromPrefix({
      session: nextSession,
      showThinkingMessages: true,
      previousTranscriptModel,
      startMessageIndex: 1,
      mode: "replace-tail",
    });

    expect(nextTranscriptModel?.hasAttachmentMessages).toBe(false);
    expect(nextTranscriptModel?.lastUserMessageId).toBe("user-tail");
  });

  test("buildAgentChatTranscriptModel skips turn duration rows for non-final assistant messages", () => {
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

    const rows = buildAgentChatTranscriptModel(session, { showThinkingMessages: true }).rows;

    expect(rows.map((row) => row.kind)).toEqual(["message"]);
    expect(rows[0]?.key).toBe(`${sessionKey}:0:assistant-live`);
  });

  test("buildAgentChatTranscriptModel marks active streaming assistant only while session activity is running", () => {
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

    const runningRowsState = buildAgentChatTranscriptModel(runningSession, {
      showThinkingMessages: true,
    });
    const idleRowsState = buildAgentChatTranscriptModel(idleSession, {
      showThinkingMessages: true,
    });

    expect(runningRowsState.activeStreamingAssistantMessageId).toBe("assistant-live");
    expect(idleRowsState.activeStreamingAssistantMessageId).toBeNull();
  });

  test("buildAgentChatTranscriptModel restores streaming metadata when session activity resumes", () => {
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

    const idleRowsState = buildAgentChatTranscriptModel(idleSession, {
      showThinkingMessages: true,
    });
    const resumedRowsState = buildAgentChatTranscriptModel(resumedSession, {
      showThinkingMessages: true,
    });

    expect(idleRowsState.activeStreamingAssistantMessageId).toBeNull();
    expect(resumedRowsState.activeStreamingAssistantMessageId).toBe("assistant-live");
  });
});
