import { describe, expect, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import {
  decideClaudeContinuation,
  decideClaudeLiveContinuation,
  decideClaudePersistedContinuation,
} from "./claude-agent-sdk-continuation";
import { createClaudeSession } from "./claude-agent-sdk-session-io.test-support";

const userMessage = (messageId: string): AgentSessionHistoryMessage => ({
  messageId,
  role: "user",
  timestamp: "2026-07-17T10:01:00.000Z",
  text: "Write the tests.",
  displayParts: [{ kind: "text", text: "Write the tests." }],
  state: "read",
  parts: [],
});

const assistantMessage = (
  messageId: string,
  finishReason?: string,
): AgentSessionHistoryMessage => ({
  messageId,
  role: "assistant",
  timestamp: "2026-07-17T10:01:01.000Z",
  text: "Working.",
  parts:
    finishReason === undefined
      ? []
      : [
          {
            kind: "step",
            messageId,
            partId: `${messageId}:finish`,
            phase: "finish",
            reason: finishReason,
          },
        ],
});

const acceptedUserMessage = (messageId: string) => ({
  messageId,
  parts: [],
  text: "Continue.",
  timestamp: "2026-06-25T20:00:01.000Z",
});

const completedTranscript = (): AgentSessionHistoryMessage[] => [
  userMessage("user-1"),
  assistantMessage("assistant-1", "stop"),
];

const unfinishedTranscript = (): AgentSessionHistoryMessage[] => [
  userMessage("user-1"),
  assistantMessage("assistant-1"),
  userMessage("user-2"),
  assistantMessage("assistant-2", "end_turn"),
];

const unusedTranscriptReader = (): Promise<readonly AgentSessionHistoryMessage[]> =>
  Promise.reject(new Error("the live decision must not read the transcript"));

describe("decideClaudeLiveContinuation", () => {
  test("rejects a session that waits for a pending approval or question", () => {
    const session = createClaudeSession({
      pendingApprovals: new Map([
        [
          "approval-1",
          {
            event: {
              type: "approval_required",
              externalSessionId: "session-1",
              timestamp: "2026-06-25T20:00:00.000Z",
              requestId: "approval-1",
              requestType: "command_execution",
              title: "Approve Bash",
              tool: { name: "Bash", input: { command: "cat /etc/passwd" } },
              mutation: "read_only",
            },
            resolve: () => {},
          },
        ],
      ]),
    });

    expect(decideClaudeLiveContinuation(session, "session-1")).toMatchObject({
      kind: "reject",
      error: { reason: "waiting_input" },
    });
  });

  test("rejects a completed latest in-process turn as completed_turn", () => {
    const session = createClaudeSession({
      acceptedUserMessages: [acceptedUserMessage("user-1")],
      lastAssistantTextFinal: true,
      lastAssistantTextTurnIndex: 1,
    });

    expect(decideClaudeLiveContinuation(session, "session-1")).toMatchObject({
      kind: "reject",
      error: {
        reason: "completed_turn",
        message: "Claude session 'session-1' has a completed latest turn.",
      },
    });
  });

  test("rejects a completed latest in-process turn without final assistant text", () => {
    const session = createClaudeSession({
      acceptedUserMessages: [acceptedUserMessage("user-1")],
      lastSuccessfulResultTurnIndex: 1,
    });

    expect(decideClaudeLiveContinuation(session, "session-1")).toMatchObject({
      kind: "reject",
      error: {
        reason: "completed_turn",
        message: "Claude session 'session-1' has a completed latest turn.",
      },
    });
  });

  test("allows an unfinished latest turn after an earlier final result", () => {
    const session = createClaudeSession({
      acceptedUserMessages: [acceptedUserMessage("user-1"), acceptedUserMessage("user-2")],
      lastAssistantTextFinal: true,
      lastAssistantTextTurnIndex: 1,
    });

    expect(decideClaudeLiveContinuation(session, "session-1")).toEqual({ kind: "allow" });
  });

  test("rejects Resume while an ordinary background tool runs", async () => {
    const session = createClaudeSession({
      acceptedUserMessages: [acceptedUserMessage("user-1")],
      activity: "idle",
      sdkState: "idle",
      backgroundToolActiveTaskIds: new Set(["bash-task"]),
    });

    await expect(
      decideClaudeContinuation(session, "session-1", unusedTranscriptReader),
    ).resolves.toMatchObject({ kind: "reject", error: { reason: "live_turn" } });

    session.backgroundToolActiveTaskIds?.clear();
    expect(decideClaudeLiveContinuation(session, "session-1")).toEqual({ kind: "allow" });
  });

  test("rejects Resume while a child session runs an ordinary background tool", () => {
    const child = createClaudeSession({
      backgroundToolActiveTaskIds: new Set(["mcp-task"]),
    });
    const session = Object.assign(
      createClaudeSession({
        acceptedUserMessages: [acceptedUserMessage("user-1")],
        activity: "idle",
        sdkState: "idle",
      }),
      { subagentEventSessionsByToolUseId: new Map([["agent-tool", child]]) },
    );

    expect(decideClaudeLiveContinuation(session, "session-1")).toMatchObject({
      kind: "reject",
      error: { reason: "live_turn" },
    });
  });

  test("asks for the transcript when the session accepted no user turn", () => {
    expect(decideClaudeLiveContinuation(createClaudeSession(), "session-1")).toEqual({
      kind: "needs_transcript",
    });
  });
});

describe("decideClaudePersistedContinuation", () => {
  test("allows a transcript whose latest user turn has no final assistant result", () => {
    expect(
      decideClaudePersistedContinuation(
        [userMessage("user-1"), assistantMessage("assistant-1"), userMessage("user-2")],
        "session-1",
      ),
    ).toEqual({ kind: "allow" });
  });

  test("allows a transcript whose latest turn never finished", () => {
    expect(decideClaudePersistedContinuation(unfinishedTranscript(), "session-1")).toEqual({
      kind: "allow",
    });
  });

  test("rejects a transcript without any user turn", () => {
    expect(
      decideClaudePersistedContinuation([assistantMessage("assistant-1")], "session-1"),
    ).toMatchObject({
      kind: "reject",
      error: {
        reason: "ineligible_turn_state",
        message: "Claude session 'session-1' has no unfinished user turn to continue.",
      },
    });
  });

  test("rejects a transcript whose latest turn has a final assistant result", () => {
    expect(decideClaudePersistedContinuation(completedTranscript(), "session-1")).toMatchObject({
      kind: "reject",
      error: {
        reason: "completed_turn",
        message: "Claude session 'session-1' has a final assistant result.",
      },
    });
  });
});

describe("decideClaudeContinuation", () => {
  test("rejects a reattached session whose persisted latest turn completed", async () => {
    const session = createClaudeSession();

    await expect(
      decideClaudeContinuation(session, "session-1", async () => completedTranscript()),
    ).resolves.toMatchObject({ kind: "reject", error: { reason: "completed_turn" } });
  });

  test("allows a reattached session whose persisted latest turn is unfinished", async () => {
    const session = createClaudeSession();

    await expect(
      decideClaudeContinuation(session, "session-1", async () => unfinishedTranscript()),
    ).resolves.toEqual({ kind: "allow" });
  });

  test("rejects a fresh session whose persisted transcript has no user turn", async () => {
    await expect(
      decideClaudeContinuation(createClaudeSession(), "session-1", async () => []),
    ).resolves.toMatchObject({ kind: "reject", error: { reason: "ineligible_turn_state" } });
  });

  test("keeps the live decision and does not read the transcript", async () => {
    const session = createClaudeSession({
      acceptedUserMessages: [acceptedUserMessage("user-1")],
      lastAssistantTextFinal: true,
      lastAssistantTextTurnIndex: 1,
    });

    await expect(
      decideClaudeContinuation(session, "session-1", unusedTranscriptReader),
    ).resolves.toMatchObject({ kind: "reject", error: { reason: "completed_turn" } });
  });
});
