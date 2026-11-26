import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import {
  decideClaudeContinuation,
  decideClaudeLiveContinuation,
  decideClaudePersistedContinuation,
} from "./claude-agent-sdk-continuation";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import { createClaudeSession } from "./claude-agent-sdk-session-io.test-support";
import {
  claudeHistoryMessagesFixture,
  claudeSdkMessageFixture,
  claudeSdkMessageUuidFixture,
} from "./claude-agent-sdk-test-messages";

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

const unusedTranscriptReader = (): Effect.Effect<readonly AgentSessionHistoryMessage[], Error> =>
  Effect.fail(new Error("the live decision must not read the transcript"));

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
      Effect.runPromise(decideClaudeContinuation(session, "session-1", unusedTranscriptReader)),
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

  test.each([
    [
      "assistant work after an earlier final reply",
      [userMessage("user-1"), assistantMessage("assistant-1", "stop"), assistantMessage("wake-1")],
    ],
    [
      "a session error after an earlier final reply",
      [
        userMessage("user-1"),
        assistantMessage("assistant-1", "stop"),
        {
          messageId: "limit-1",
          role: "system",
          timestamp: "2026-07-17T10:02:00.000Z",
          text: "Weekly limit reached.",
          notice: {
            tone: "error",
            reason: "session_error",
            title: "Error",
            usageLimit: { resetsAtEpochMs: 1795712400000 },
          },
          parts: [],
        },
      ],
    ],
  ] satisfies Array<[string, AgentSessionHistoryMessage[]]>)(
    "allows a persisted transcript with %s",
    (_label, history) => {
      expect(decideClaudePersistedContinuation(history, "session-1")).toEqual({ kind: "allow" });
    },
  );

  test.each([
    [
      "a completed wake turn after an earlier final reply",
      [
        userMessage("user-1"),
        assistantMessage("assistant-1", "stop"),
        assistantMessage("wake-1"),
        assistantMessage("wake-final", "stop"),
      ],
    ],
    [
      "a non-error system notice after a final reply",
      [
        userMessage("user-1"),
        assistantMessage("assistant-1", "stop"),
        {
          messageId: "compact-1",
          role: "system",
          timestamp: "2026-07-17T10:02:00.000Z",
          text: "Session compacted.",
          notice: {
            tone: "info",
            reason: "session_compacted",
            title: "Compacted",
          },
          parts: [],
        },
      ],
    ],
    [
      "a subagent-only status row after a final reply",
      [
        userMessage("user-1"),
        assistantMessage("assistant-1", "stop"),
        {
          messageId: "claude-subagent:task-1",
          role: "assistant",
          timestamp: "2026-07-17T10:02:00.000Z",
          text: "",
          parts: [
            {
              kind: "subagent",
              messageId: "claude-subagent:task-1",
              partId: "claude-subagent:task-1:part",
              correlationKey: "subagent:task-1",
              status: "completed",
              description: "Background review",
            },
          ],
        },
      ],
    ],
  ] satisfies Array<[string, AgentSessionHistoryMessage[]]>)(
    "rejects a persisted transcript with %s",
    (_label, history) => {
      expect(decideClaudePersistedContinuation(history, "session-1")).toMatchObject({
        kind: "reject",
        error: { reason: "completed_turn" },
      });
    },
  );

  test("rejects a completed transcript followed by a late task_notification projection", () => {
    const timestamp = "2026-07-17T10:02:00.000Z";
    const history = toClaudeHistoryMessages(
      claudeHistoryMessagesFixture([
        claudeSdkMessageFixture({
          type: "user",
          uuid: claudeSdkMessageUuidFixture("user-1"),
          message: { role: "user", content: "Ship the change" },
        }),
        claudeSdkMessageFixture({
          type: "assistant",
          uuid: claudeSdkMessageUuidFixture("assistant-1"),
          message: {
            id: "reply-1",
            role: "assistant",
            content: [{ type: "text", text: "Done." }],
            stop_reason: "end_turn",
          },
        }),
        claudeSdkMessageFixture({
          type: "system",
          subtype: "task_notification",
          uuid: claudeSdkMessageUuidFixture("notif-1"),
          task_id: "bg-task-1",
          status: "completed",
          output_file: "/tmp/bg.log",
          summary: "Background check finished.",
        }),
      ]),
      () => timestamp,
    );

    expect(history.at(-1)?.role).toBe("assistant");
    expect(history.at(-1)?.text).toBe("");
    expect(history.at(-1)?.parts.map((part) => part.kind)).toEqual(["subagent"]);
    expect(decideClaudePersistedContinuation(history, "session-1")).toMatchObject({
      kind: "reject",
      error: { reason: "completed_turn" },
    });
  });
});

describe("decideClaudeContinuation", () => {
  test("rejects a reattached session whose persisted latest turn completed", async () => {
    const session = createClaudeSession();

    await expect(
      Effect.runPromise(
        decideClaudeContinuation(session, "session-1", () => Effect.succeed(completedTranscript())),
      ),
    ).resolves.toMatchObject({ kind: "reject", error: { reason: "completed_turn" } });
  });

  test("allows a reattached session whose persisted latest turn is unfinished", async () => {
    const session = createClaudeSession();

    await expect(
      Effect.runPromise(
        decideClaudeContinuation(session, "session-1", () =>
          Effect.succeed(unfinishedTranscript()),
        ),
      ),
    ).resolves.toEqual({ kind: "allow" });
  });

  test("rejects a fresh session whose persisted transcript has no user turn", async () => {
    await expect(
      Effect.runPromise(
        decideClaudeContinuation(createClaudeSession(), "session-1", () => Effect.succeed([])),
      ),
    ).resolves.toMatchObject({ kind: "reject", error: { reason: "ineligible_turn_state" } });
  });

  test("keeps the live decision and does not read the transcript", async () => {
    const session = createClaudeSession({
      acceptedUserMessages: [acceptedUserMessage("user-1")],
      lastAssistantTextFinal: true,
      lastAssistantTextTurnIndex: 1,
    });

    await expect(
      Effect.runPromise(decideClaudeContinuation(session, "session-1", unusedTranscriptReader)),
    ).resolves.toMatchObject({ kind: "reject", error: { reason: "completed_turn" } });
  });
});
