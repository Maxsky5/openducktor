import { describe, expect, test } from "bun:test";
import type { SDKRateLimitEvent, SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import {
  decideClaudeLiveContinuation,
  decideClaudePersistedContinuation,
} from "./claude-agent-sdk-continuation";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import { createClaudeSession } from "./claude-agent-sdk-session-io.test-support";
import {
  claudeHistoryMessagesFixture,
  claudeSdkMessageFixture,
  claudeSdkMessageUuidFixture,
} from "./claude-agent-sdk-test-messages";

const rateLimitEvent = (info: SDKRateLimitInfo): SDKRateLimitEvent => ({
  type: "rate_limit_event",
  session_id: "session-1",
  uuid: "00000000-0000-4000-8000-000000000004",
  rate_limit_info: info,
});

describe("Claude usage-limit recovery", () => {
  test.each([
    ["before_error", 1, {}],
    ["after_result", 1, {}],
    ["before_error", 2, {}],
    ["after_result", 2, {}],
    ["before_error", 1, { isUsingOverage: true }],
    ["after_result", 1, { overageInUse: true }],
  ] as const)(
    "keeps the reset when its event arrives %s with %i prompts and %j",
    (order, prompts, overage) => {
      const timestamp = "2026-10-08T00:24:06.000Z";
      const session = createClaudeSession({
        activity: "running",
        acceptedUserMessages: Array.from({ length: prompts }, (_, index) => ({
          messageId: `user-${index + 1}`,
          text: "Build",
          parts: [],
          timestamp,
        })),
        pendingUserTurnCount: prompts,
      });
      const events: AgentEvent[] = [];
      const handle = (message: Parameters<typeof handleClaudeSdkMessage>[0]["message"]) =>
        handleClaudeSdkMessage({
          session,
          message,
          timestamp,
          emit: (event) => events.push(event),
          modelSelection: (modelId) => ({ providerId: "claude", modelId, runtimeKind: "claude" }),
        });
      const error = (id: string) =>
        claudeSdkMessageFixture({
          type: "assistant",
          session_id: "session-1",
          uuid: claudeSdkMessageUuidFixture(id),
          error: "rate_limit",
          message: {
            id,
            content: [{ type: "text", text: "Session limit" }],
            stop_reason: "end_turn",
          },
        });
      const result = (id: string) =>
        claudeSdkMessageFixture({
          type: "result",
          subtype: "error_during_execution",
          session_id: "session-1",
          uuid: claudeSdkMessageUuidFixture(id),
          user_message_uuid: id === "queued-result" ? "user-2" : "user-1",
          errors: ["Session limit. Wait for usage to reset."],
        });
      const rateLimit = rateLimitEvent({
        status: "rejected",
        rateLimitType: "five_hour",
        resetsAt: 1791430800,
        ...overage,
      });
      const messages =
        order === "before_error"
          ? [rateLimit, error("limit-response"), result("limit-result")]
          : [error("limit-response"), result("limit-result"), rateLimit];
      for (const message of messages) {
        handle(message);
      }
      const errors = events.filter((event) => event.type === "turn_error");
      expect(errors.at(-1)).toMatchObject({
        messageId: "limit-response",
        message: "Session limit. Wait for usage to reset.",
        usageLimit: { resetsAtEpochMs: 1791430800000 },
      });
      expect(new Set(errors.map((event) => event.messageId)).size).toBe(1);
      expect(decideClaudeLiveContinuation(session, "session-1").kind).toBe(
        prompts === 1 ? "allow" : "reject",
      );
      if (prompts === 2) {
        handle(error("queued-limit-response"));
        expect(events.filter((event) => event.type === "turn_error").at(-1)?.usageLimit).toEqual(
          {},
        );
        handle(result("queued-result"));
        handle(
          rateLimitEvent({ status: "rejected", rateLimitType: "five_hour", resetsAt: 1791434400 }),
        );
        const queuedErrors = events.filter((event) => event.type === "turn_error");
        expect(queuedErrors.at(-1)).toMatchObject({
          messageId: "queued-limit-response",
          usageLimit: { resetsAtEpochMs: 1791434400000 },
        });
        expect(
          queuedErrors.findLast((event) => event.messageId === "limit-response"),
        ).toMatchObject({
          usageLimit: { resetsAtEpochMs: 1791430800000 },
        });
        expect(decideClaudeLiveContinuation(session, "session-1")).toEqual({ kind: "allow" });
        for (const message of [
          claudeSdkMessageFixture({
            type: "assistant",
            message: {
              id: "next-response",
              content: [{ type: "text", text: "Next turn output" }],
            },
          }),
          rateLimit,
        ]) {
          handle(message);
        }
        expect(events.filter((event) => event.type === "turn_error")).toHaveLength(
          queuedErrors.length,
        );
      }
    },
  );

  test.each([
    { status: "allowed", resetsAt: 1791430800 },
    { status: "allowed_warning", resetsAt: 1791430800 },
    { status: "rejected" },
  ] satisfies SDKRateLimitInfo[])("does not invent a reset time from %j", (info) => {
    const session = createClaudeSession();
    const events: AgentEvent[] = [];
    const handle = (message: Parameters<typeof handleClaudeSdkMessage>[0]["message"]) =>
      handleClaudeSdkMessage({
        session,
        message,
        timestamp: "2026-10-08T00:24:06.000Z",
        emit: (event) => events.push(event),
        modelSelection: (modelId) => ({ providerId: "claude", modelId, runtimeKind: "claude" }),
      });
    handle(rateLimitEvent(info));
    expect(events).toEqual([]);
    handle(
      claudeSdkMessageFixture({
        type: "assistant",
        error: "rate_limit",
        message: { content: [{ type: "text", text: "Session limit" }], stop_reason: "end_turn" },
      }),
    );
    expect(events.find((event) => event.type === "turn_error")).toMatchObject({ usageLimit: {} });
  });

  test.each(["rate_limit", "server_error"] as const)(
    "replaces same-ID history snapshots with one %s notice",
    (error) => {
      const timestamp = "2026-10-08T00:24:06.000Z";
      const user = claudeSdkMessageFixture({
        type: "user",
        uuid: claudeSdkMessageUuidFixture("user"),
        message: { content: "Build" },
      });
      const kept = claudeSdkMessageFixture({
        type: "assistant",
        uuid: claudeSdkMessageUuidFixture("kept"),
        message: {
          id: "kept-response",
          content: [{ type: "text", text: "Keep this output" }],
        },
      });
      const snapshots = ["Partial output", "More partial output"].map((text, index) =>
        claudeSdkMessageFixture({
          type: "assistant",
          uuid: claudeSdkMessageUuidFixture(`snapshot-${index}`),
          message: { id: "shared-response", content: [{ type: "text", text }] },
        }),
      );
      const errors = ["First error", "Updated error"].map((text, index) =>
        claudeSdkMessageFixture({
          type: "assistant",
          uuid: claudeSdkMessageUuidFixture(`error-${index}`),
          error,
          message: {
            id: "shared-response",
            model: "<synthetic>",
            content: [{ type: "text", text }],
            stop_reason: "end_turn",
          },
        }),
      );
      const result = claudeSdkMessageFixture({
        type: "result",
        subtype: "error_during_execution",
        uuid: claudeSdkMessageUuidFixture("result"),
        errors: ["The turn failed. Try again."],
      });
      const history = toClaudeHistoryMessages(
        claudeHistoryMessagesFixture([user, kept, ...snapshots, ...errors, result]),
        () => timestamp,
      );

      expect(history.map((message) => message.messageId)).toEqual([
        user.uuid,
        "kept-response",
        "shared-response",
      ]);
      expect(history[1]).toMatchObject({ role: "assistant", text: "Keep this output" });
      const notice = history.at(-1);
      expect(notice).toMatchObject({
        role: "system",
        text: "The turn failed. Try again.",
        parts: [],
        notice: { reason: "session_error" },
      });
      if (error === "rate_limit") {
        expect(notice).toMatchObject({ notice: { usageLimit: {} } });
      }
      expect(decideClaudePersistedContinuation(history, "session-1")).toEqual({ kind: "allow" });
    },
  );

  test.each(["claude-sonnet-4-6", "<synthetic>"])(
    "keeps Resume available after a session-limit error from %s, live and after history restore",
    (model) => {
      const timestamp = "2026-10-08T00:24:06.000Z";
      const text = "You've hit your session limit · resets 5:10am (Europe/Paris)";
      const user = claudeSdkMessageFixture({
        type: "user",
        uuid: "00000000-0000-4000-8000-000000000001",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: { role: "user", content: "Fix the build" },
      });
      const assistant = claudeSdkMessageFixture({
        type: "assistant",
        uuid: "00000000-0000-4000-8000-000000000002",
        session_id: "session-1",
        parent_tool_use_id: null,
        error: "rate_limit",
        message: {
          id: "limit-response",
          model,
          role: "assistant",
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
        },
      });
      const result = claudeSdkMessageFixture({
        type: "result",
        subtype: "error_during_execution",
        uuid: "00000000-0000-4000-8000-000000000003",
        user_message_uuid: user.uuid,
        session_id: "session-1",
        is_error: true,
        errors: [text],
      });
      const session = createClaudeSession({
        activity: "running",
        acceptedUserMessages: [
          { messageId: user.uuid, text: "Fix the build", parts: [], timestamp },
        ],
        pendingUserTurnCount: 1,
      });
      const events: AgentEvent[] = [];
      for (const message of [assistant, result]) {
        handleClaudeSdkMessage({
          session,
          message,
          timestamp,
          emit: (event) => events.push(event),
          modelSelection: (modelId) => ({ providerId: "claude", modelId, runtimeKind: "claude" }),
        });
      }

      expect(session.activity).toBe("idle");
      expect(decideClaudeLiveContinuation(session, "session-1")).toEqual({ kind: "allow" });
      expect(events.some((event) => event.type === "assistant_message")).toBe(false);
      expect(events).toContainEqual(expect.objectContaining({ type: "turn_error", message: text }));

      const history = toClaudeHistoryMessages(
        claudeHistoryMessagesFixture([user, assistant, result]),
        () => timestamp,
      );
      expect(decideClaudePersistedContinuation(history, "session-1")).toEqual({ kind: "allow" });
      expect(history.find((message) => message.messageId === "limit-response")).toMatchObject({
        role: "system",
        text,
        notice: { reason: "session_error" },
      });
      expect(history.filter((message) => message.role === "system")).toHaveLength(1);
    },
  );

  test.each([
    [
      "task-notification wake turn",
      () => [
        claudeSdkMessageFixture({
          type: "user",
          uuid: claudeSdkMessageUuidFixture("wake-user"),
          session_id: "session-1",
          parent_tool_use_id: null,
          origin: { kind: "task-notification" },
          message: { role: "user", content: "<task-notification>finished</task-notification>" },
        }),
      ],
    ],
    [
      "scheduled meta wakeup",
      () => [
        claudeSdkMessageFixture({
          type: "user",
          uuid: claudeSdkMessageUuidFixture("meta-wake"),
          session_id: "session-1",
          parent_tool_use_id: null,
          isSynthetic: true,
          message: { role: "user", content: "Continue scheduled check." },
        }),
      ],
    ],
  ] as const)(
    "allows Resume when a %s hits a usage limit after a completed turn",
    (_label, wakeMessages) => {
      const timestamp = "2026-11-26T06:53:39.000Z";
      const text = "You've hit your weekly limit · resets 6pm (Europe/Paris)";
      const user = claudeSdkMessageFixture({
        type: "user",
        uuid: claudeSdkMessageUuidFixture("user-1"),
        session_id: "session-1",
        parent_tool_use_id: null,
        message: { role: "user", content: "Monitor the PR" },
      });
      const completedAssistant = claudeSdkMessageFixture({
        type: "assistant",
        uuid: claudeSdkMessageUuidFixture("assistant-1"),
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          id: "completed-response",
          model: "claude-opus-5-5",
          role: "assistant",
          content: [{ type: "text", text: "Waiting for CI." }],
          stop_reason: "end_turn",
        },
      });
      const completedResult = claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        uuid: claudeSdkMessageUuidFixture("result-1"),
        user_message_uuid: user.uuid,
        session_id: "session-1",
        is_error: false,
        result: "Waiting for CI.",
        stop_reason: "end_turn",
        terminal_reason: "completed",
      });
      const limitAssistant = claudeSdkMessageFixture({
        type: "assistant",
        uuid: claudeSdkMessageUuidFixture("limit-assistant"),
        session_id: "session-1",
        parent_tool_use_id: null,
        error: "rate_limit",
        message: {
          id: "limit-response",
          model: "<synthetic>",
          role: "assistant",
          content: [{ type: "text", text }],
          stop_reason: "stop_sequence",
        },
      });
      const limitResult = claudeSdkMessageFixture({
        type: "result",
        subtype: "error_during_execution",
        uuid: claudeSdkMessageUuidFixture("limit-result"),
        session_id: "session-1",
        is_error: true,
        errors: [text],
      });
      const session = createClaudeSession({
        activity: "running",
        acceptedUserMessages: [
          { messageId: user.uuid, text: "Monitor the PR", parts: [], timestamp },
        ],
        pendingUserTurnCount: 1,
        activeSdkUserTurnCount: 1,
      });
      const events: AgentEvent[] = [];
      const handle = (message: Parameters<typeof handleClaudeSdkMessage>[0]["message"]) =>
        handleClaudeSdkMessage({
          session,
          message,
          timestamp,
          emit: (event) => events.push(event),
          modelSelection: (modelId) => ({ providerId: "claude", modelId, runtimeKind: "claude" }),
        });

      handle(completedAssistant);
      handle(completedResult);
      expect(decideClaudeLiveContinuation(session, "session-1")).toMatchObject({
        kind: "reject",
        error: { reason: "completed_turn" },
      });

      const wakes = wakeMessages();
      for (const message of [
        ...wakes,
        rateLimitEvent({ status: "rejected", rateLimitType: "seven_day", resetsAt: 1795712400 }),
        limitAssistant,
        limitResult,
      ]) {
        handle(message);
      }

      expect(session.activity).toBe("idle");
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "turn_error",
          messageId: "limit-response",
          usageLimit: { resetsAtEpochMs: 1795712400000 },
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "session_turn_finished",
          turnOutcome: "failed",
        }),
      );
      expect(decideClaudeLiveContinuation(session, "session-1")).toEqual({ kind: "allow" });

      const history = toClaudeHistoryMessages(
        claudeHistoryMessagesFixture([
          user,
          completedAssistant,
          completedResult,
          ...wakes,
          limitAssistant,
          limitResult,
        ]),
        () => timestamp,
      );
      expect(decideClaudePersistedContinuation(history, "session-1")).toEqual({ kind: "allow" });
    },
  );

  test("rejects Resume after a wake turn completes successfully", () => {
    const timestamp = "2026-11-26T06:53:39.000Z";
    const session = createClaudeSession({
      activity: "idle",
      acceptedUserMessages: [
        { messageId: claudeSdkMessageUuidFixture("user-1"), text: "Build", parts: [], timestamp },
      ],
      lastSuccessfulResultTurnIndex: 1,
      lastAssistantTextFinal: true,
      lastAssistantTextTurnIndex: 1,
    });
    const handle = (message: Parameters<typeof handleClaudeSdkMessage>[0]["message"]) =>
      handleClaudeSdkMessage({
        session,
        message,
        timestamp,
        emit: () => {},
        modelSelection: (modelId) => ({ providerId: "claude", modelId, runtimeKind: "claude" }),
      });

    handle(
      claudeSdkMessageFixture({
        type: "user",
        uuid: claudeSdkMessageUuidFixture("wake-user"),
        session_id: "session-1",
        parent_tool_use_id: null,
        origin: { kind: "task-notification" },
        message: { role: "user", content: "<task-notification>finished</task-notification>" },
      }),
    );
    handle(
      claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        uuid: claudeSdkMessageUuidFixture("wake-result"),
        session_id: "session-1",
        is_error: false,
        result: "All checks passed.",
        stop_reason: "end_turn",
        terminal_reason: "completed",
      }),
    );

    expect(decideClaudeLiveContinuation(session, "session-1")).toMatchObject({
      kind: "reject",
      error: { reason: "completed_turn" },
    });
  });

  test.each([
    ["preserves Resume after a weekly-limit stop", false, "allow"],
    ["keeps a completed turn settled", true, "reject"],
  ] as const)(
    "empty notification-only wake %s without emitting a final marker",
    (_label, priorCompleted, expectedKind) => {
      const timestamp = "2026-11-26T06:54:00.000Z";
      const session = createClaudeSession({
        activity: "idle",
        acceptedUserMessages: [
          {
            messageId: claudeSdkMessageUuidFixture("user-1"),
            text: "Monitor the PR",
            parts: [],
            timestamp,
          },
        ],
      });
      if (priorCompleted) {
        session.lastSuccessfulResultTurnIndex = 1;
        session.lastAssistantTextFinal = true;
        session.lastAssistantTextTurnIndex = 1;
      }
      const events: AgentEvent[] = [];
      const handle = (message: Parameters<typeof handleClaudeSdkMessage>[0]["message"]) =>
        handleClaudeSdkMessage({
          session,
          message,
          timestamp,
          emit: (event) => events.push(event),
          modelSelection: (modelId) => ({ providerId: "claude", modelId, runtimeKind: "claude" }),
        });

      handle(
        claudeSdkMessageFixture({
          type: "user",
          uuid: claudeSdkMessageUuidFixture("empty-wake-user"),
          session_id: "session-1",
          parent_tool_use_id: null,
          origin: { kind: "task-notification" },
          message: { role: "user", content: "<task-notification>done</task-notification>" },
        }),
      );
      handle(
        claudeSdkMessageFixture({
          type: "result",
          subtype: "success",
          uuid: claudeSdkMessageUuidFixture("empty-wake-result"),
          session_id: "session-1",
          is_error: false,
          result: "",
          stop_reason: "end_turn",
          terminal_reason: "completed",
          origin: { kind: "task-notification" },
        }),
      );

      expect(events.some((event) => event.type === "assistant_message")).toBe(false);
      expect(decideClaudeLiveContinuation(session, "session-1").kind).toBe(expectedKind);
    },
  );

  test("settles both live host and transcript marker when a wake runs assistant work and finishes without text", () => {
    const timestamp = "2026-11-26T06:54:00.000Z";
    const session = createClaudeSession({
      activity: "idle",
      acceptedUserMessages: [
        {
          messageId: claudeSdkMessageUuidFixture("user-1"),
          text: "Monitor the PR",
          parts: [],
          timestamp,
        },
      ],
    });
    const events: AgentEvent[] = [];
    const handle = (message: Parameters<typeof handleClaudeSdkMessage>[0]["message"]) =>
      handleClaudeSdkMessage({
        session,
        message,
        timestamp,
        emit: (event) => events.push(event),
        modelSelection: (modelId) => ({ providerId: "claude", modelId, runtimeKind: "claude" }),
      });

    handle(
      claudeSdkMessageFixture({
        type: "user",
        uuid: claudeSdkMessageUuidFixture("tool-wake-user"),
        session_id: "session-1",
        parent_tool_use_id: null,
        origin: { kind: "task-notification" },
        message: { role: "user", content: "<task-notification>done</task-notification>" },
      }),
    );
    handle(
      claudeSdkMessageFixture({
        type: "assistant",
        uuid: claudeSdkMessageUuidFixture("tool-wake-assistant"),
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          id: "tool-wake-msg",
          role: "assistant",
          content: [{ type: "tool_use", id: "tu-1", name: "Bash", input: { command: "echo ok" } }],
          stop_reason: "tool_use",
        },
      }),
    );
    handle(
      claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        uuid: claudeSdkMessageUuidFixture("tool-wake-result"),
        session_id: "session-1",
        is_error: false,
        result: "",
        stop_reason: "end_turn",
        terminal_reason: "completed",
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_message",
        messageId: claudeSdkMessageUuidFixture("tool-wake-result"),
        message: "",
      }),
    );
    expect(decideClaudeLiveContinuation(session, "session-1")).toMatchObject({
      kind: "reject",
      error: { reason: "completed_turn" },
    });
  });
});
