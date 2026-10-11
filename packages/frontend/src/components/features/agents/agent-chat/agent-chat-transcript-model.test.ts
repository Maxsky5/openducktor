import { describe, expect, test } from "bun:test";
import { getSessionMessages } from "@/state/operations/agent-orchestrator/support/messages";
import { buildMessage, buildSession } from "./agent-chat-test-fixtures";
import {
  buildAgentChatTranscriptModel,
  buildAgentChatTurnAnchors,
  updateAgentChatTranscriptModelFromPrefix,
} from "./agent-chat-transcript-model";

describe("agent chat transcript model", () => {
  test("keeps one initial system prompt above the first user message during live updates and hydration", () => {
    const user = buildMessage("user", "Question", { id: "user-1" });
    const prompt = buildMessage("system", "System prompt:\n\nInitial instructions", {
      id: "prompt-1",
    });
    const answer = buildMessage("assistant", "Answer", { id: "assistant-1" });
    const update = buildMessage("system", "Instructions update:\n\nTool catalog update", {
      id: "prompt-2",
    });
    const followup = buildMessage("user", "Follow-up", { id: "user-2" });
    const session = buildSession({ messages: [user] });
    const initial = buildAgentChatTranscriptModel(session, { showThinkingMessages: true });
    const firstTurn = buildSession({ ...session, messages: [user, prompt, answer] });
    const live = updateAgentChatTranscriptModelFromPrefix({
      session: firstTurn,
      showThinkingMessages: true,
      previousTranscriptModel: initial,
      startMessageIndex: 1,
      mode: "append",
    })!;
    expect(live.rows.flatMap((row) => (row.kind === "message" ? [row.message.id] : []))).toEqual([
      "prompt-1",
      "user-1",
      "assistant-1",
    ]);
    const completed = buildSession({
      ...session,
      messages: [user, prompt, answer, update, followup],
    });
    const appended = updateAgentChatTranscriptModelFromPrefix({
      session: completed,
      showThinkingMessages: true,
      previousTranscriptModel: live,
      startMessageIndex: 3,
      mode: "append",
    })!;
    expect(
      appended.rows.flatMap((row) => (row.kind === "message" ? [row.message.id] : [])),
    ).toEqual(["prompt-1", "user-1", "assistant-1", "prompt-2", "user-2"]);
    expect(appended).toEqual(
      buildAgentChatTranscriptModel(completed, { showThinkingMessages: true }),
    );
    expect(getSessionMessages(completed)).toHaveLength(5);
  });
  test("keeps row keys when history adds older messages before visible messages", () => {
    const messages = [
      buildMessage("user", "Question", { id: "user-1" }),
      buildMessage("assistant", "Answer", { id: "assistant-1" }),
    ];
    const session = buildSession({ messages });
    const before = buildAgentChatTranscriptModel(session, { showThinkingMessages: true });
    const after = buildAgentChatTranscriptModel(
      buildSession({
        ...session,
        messages: [buildMessage("assistant", "Earlier answer", { id: "older" }), ...messages],
      }),
      { showThinkingMessages: true },
    );
    expect(
      after.rows
        .filter((row) => row.kind === "message" && row.message.id !== "older")
        .map((row) => row.key),
    ).toEqual(before.rows.filter((row) => row.kind === "message").map((row) => row.key));
  });
  test("renders a fork notice as a standalone boundary without hiding inherited history", () => {
    const session = buildSession({
      messages: [
        buildMessage("user", "Inherited parent prompt", { id: "parent-user" }),
        buildMessage("assistant", "Inherited parent answer", { id: "parent-assistant" }),
        buildMessage("system", "Session forked here", {
          id: "fork-boundary",
          meta: {
            kind: "session_notice",
            tone: "info",
            reason: "session_forked",
            title: "Session forked here",
            parentExternalSessionId: "parent-thread",
          },
        }),
        buildMessage("user", "Child task", { id: "child-user" }),
        buildMessage("assistant", "Child result", { id: "child-assistant" }),
      ],
      pendingQuestions: [],
    });

    const model = buildAgentChatTranscriptModel(session, { showThinkingMessages: true });

    expect(model.rows.map((row) => row.kind)).toEqual([
      "message",
      "turn_duration",
      "message",
      "fork_boundary",
      "message",
      "turn_duration",
      "message",
    ]);
    expect(model.rows[3]).toMatchObject({
      kind: "fork_boundary",
      label: "Session forked here",
      parentExternalSessionId: "parent-thread",
    });
    expect(
      model.rows.filter((row) => row.kind === "message").map((row) => row.message.content),
    ).toEqual(["Inherited parent prompt", "Inherited parent answer", "Child task", "Child result"]);
  });

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

    const rows = buildAgentChatTranscriptModel(session, { showThinkingMessages: true }).rows;

    expect(rows.flatMap((row) => (row.kind === "message" ? [row.message.id] : []))).toEqual([
      "assistant-1",
      "user-1",
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

    const rows = buildAgentChatTranscriptModel(session, { showThinkingMessages: true }).rows;
    const turnAnchors = buildAgentChatTurnAnchors(rows);

    expect(turnAnchors).toEqual([
      {
        key: rows[0]?.key ?? "missing-row",
        startRow: 0,
        endRowExclusive: 2,
      },
      {
        key: rows[2]?.key ?? "missing-row",
        startRow: 2,
        endRowExclusive: 5,
      },
      {
        key: rows[5]?.key ?? "missing-row",
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
    expect(firstKeys.some((key) => secondKeys.includes(key))).toBe(false);
  });

  test("buildAgentChatTranscriptModel keeps same-session duplicate message ids distinct", () => {
    const session = buildSession({
      messages: [
        buildMessage("user", "First", { id: "message-1" }),
        buildMessage("user", "Second", { id: "message-1" }),
      ],
      pendingQuestions: [],
    });

    const model = buildAgentChatTranscriptModel(session, { showThinkingMessages: true });

    expect(new Set(model.rows.map((row) => row.key)).size).toBe(model.rows.length);
    expect(model.turnAnchors.map((turn) => turn.key)).toEqual(model.rows.map((row) => row.key));
    expect(model.lastUserMessageKey).toBe(model.rows[1]?.key ?? null);
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

    const visibleRows = buildAgentChatTranscriptModel(session, {
      showThinkingMessages: true,
    }).rows;
    const hiddenRows = buildAgentChatTranscriptModel(session, {
      showThinkingMessages: false,
    }).rows;

    expect(hiddenRows.map((row) => row.key)).toEqual(
      visibleRows
        .filter((row) => row.kind !== "message" || row.message.role !== "thinking")
        .map((row) => row.key),
    );
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
    expect(nextTranscriptModel.rows.map((row) => row.key)).toEqual(
      buildAgentChatTranscriptModel(nextSession, { showThinkingMessages: false }).rows.map(
        (row) => row.key,
      ),
    );
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
    expect(nextTranscriptModel.rows.map((row) => row.key)).toEqual(
      buildAgentChatTranscriptModel(nextSession, { showThinkingMessages: false }).rows.map(
        (row) => row.key,
      ),
    );
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
    expect(nextTranscriptModel?.lastUserMessageKey).toBe(
      nextTranscriptModel?.rows.findLast(
        (row) => row.kind === "message" && row.message.role === "user",
      )?.key,
    );
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

    const rows = buildAgentChatTranscriptModel(session, { showThinkingMessages: true }).rows;

    expect(rows.map((row) => row.kind)).toEqual(["message"]);
    expect(rows[0]?.kind === "message" && rows[0].message.id).toBe("assistant-live");
  });

  test("buildAgentChatTranscriptModel hides a final assistant message without content", () => {
    const session = buildSession({
      messages: [
        buildMessage("assistant", "", {
          id: "assistant-settled",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: true,
            durationMs: 2_400,
          },
        }),
      ],
      pendingQuestions: [],
    });

    const rows = buildAgentChatTranscriptModel(session, { showThinkingMessages: true }).rows;

    expect(rows.map((row) => row.kind)).toEqual(["turn_duration"]);
    expect(rows[0]?.kind === "turn_duration" && rows[0].durationMs).toBe(2400);
  });

  test("buildAgentChatTranscriptModel keeps streaming metadata independent of session activity", () => {
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
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
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
    expect(idleRowsState.activeStreamingAssistantMessageId).toBe("assistant-live");
  });

  test("buildAgentChatTranscriptModel preserves streaming metadata when session activity resumes", () => {
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
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
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

    expect(idleRowsState.activeStreamingAssistantMessageId).toBe("assistant-live");
    expect(resumedRowsState.activeStreamingAssistantMessageId).toBe("assistant-live");
  });
});
