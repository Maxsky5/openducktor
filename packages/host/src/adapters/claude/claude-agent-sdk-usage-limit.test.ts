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
  claudeHistoryMessageFixtures,
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
    ["before_error", 1],
    ["after_result", 1],
    ["before_error", 2],
    ["after_result", 2],
  ] as const)(
    "uses the SDK reset timestamp when the rate-limit event arrives %s with %i prompts",
    (order, prompts) => {
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
      const error = claudeSdkMessageFixture({
        type: "assistant",
        session_id: "session-1",
        error: "rate_limit",
        message: {
          id: "limit-response",
          content: [{ type: "text", text: "Session limit" }],
          stop_reason: "end_turn",
        },
      });
      const result = claudeSdkMessageFixture({
        type: "result",
        subtype: "error_during_execution",
        session_id: "session-1",
        errors: ["Session limit. Wait for usage to reset."],
      });
      const rateLimit = rateLimitEvent({
        status: "rejected",
        rateLimitType: "five_hour",
        resetsAt: 1791430800,
      });
      const messages =
        order === "before_error" ? [rateLimit, error, result] : [error, result, rateLimit];
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
        expect(events.filter((event) => event.type === "turn_error")).toHaveLength(errors.length);
      }
    },
  );

  test.each([
    { status: "allowed", resetsAt: 1791430800 },
    { status: "allowed_warning", resetsAt: 1791430800 },
    { status: "rejected" },
    { status: "rejected", resetsAt: 1791430800, isUsingOverage: true },
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
        claudeHistoryMessageFixtures([user, kept, ...snapshots, ...errors, result]),
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
        claudeHistoryMessageFixtures([user, assistant, result]),
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
});
