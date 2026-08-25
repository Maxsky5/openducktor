import { describe, expect, test } from "bun:test";
import {
  CodexRuntimeEventSubscriptions,
  threadIdFromRuntimeStreamEvent,
} from "./codex-runtime-events";
import type { CodexAppServerStreamEvent } from "./types";
import {
  codexRuntimeStreamFault,
  parseCodexRuntimeStreamEvent,
} from "./codex-runtime-event-schema";

const receivedAt = "2026-08-20T12:00:00.000Z";

describe("CodexRuntimeEventSubscriptions", () => {
  test("does not rewrite padded runtime methods or fault thread ids", () => {
    expect(
      parseCodexRuntimeStreamEvent({
        runtimeId: "runtime-1",
        kind: "notification",
        receivedAt,
        message: { method: " item/started ", params: {} },
      }),
    ).toMatchObject({
      kind: "ignored_notification",
      message: { method: " item/started " },
    });

    expect(
      codexRuntimeStreamFault({
        cause: new Error("Malformed event"),
        message: { method: "turn/started", params: { threadId: " thread-1 " } },
        receivedAt,
        runtimeId: "runtime-1",
        sourceKind: "notification",
      }).threadId,
    ).toBe(" thread-1 ");
  });

  test("routes malformed known envelopes as faults and ignores future notifications", async () => {
    let listener: ((event: CodexAppServerStreamEvent) => void) | undefined;
    const events: Array<Parameters<typeof threadIdFromRuntimeStreamEvent>[0]> = [];
    const subscriptions = new CodexRuntimeEventSubscriptions((_runtimeId, next) => {
      listener = next;
      return () => undefined;
    });

    await subscriptions.ensure("runtime-1", (event) => events.push(event));
    if (!listener) {
      throw new Error("Expected a Codex runtime event listener.");
    }

    listener({
      runtimeId: "runtime-1",
      kind: "server_request",
      receivedAt,
      message: null,
    });
    listener({
      runtimeId: "runtime-1",
      kind: "server_request",
      receivedAt,
      message: {
        id: "request-1",
        method: "item/commandExecution/requestApproval",
        params: { threadId: "thread-1", turnId: "turn-1", itemId: null, command: "pwd" },
      },
    });
    listener({
      runtimeId: "runtime-1",
      kind: "notification",
      receivedAt,
      message: { method: "turn/started", params: { threadId: "thread-1", turn: null } },
    });
    listener({
      runtimeId: "runtime-1",
      kind: "notification",
      receivedAt,
      message: { method: "future/unknown", params: { threadId: "thread-1" } },
    });

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      kind: "fault",
      sourceKind: "server_request",
      threadId: null,
      message: expect.stringContaining("expected object"),
    });
    expect(events[1]).toMatchObject({
      kind: "fault",
      sourceKind: "server_request",
      threadId: "thread-1",
      message: expect.stringContaining("itemId"),
    });
    expect(events[2]).toMatchObject({
      kind: "fault",
      sourceKind: "notification",
      threadId: "thread-1",
      message: expect.stringContaining("turn"),
    });
  });

  test("preserves routed approval and resolution notification identities", async () => {
    let listener: ((event: CodexAppServerStreamEvent) => void) | undefined;
    let unsubscribeCount = 0;
    let subscribeCount = 0;
    const events: Array<Parameters<typeof threadIdFromRuntimeStreamEvent>[0]> = [];
    const subscriptions = new CodexRuntimeEventSubscriptions((_runtimeId, next) => {
      subscribeCount += 1;
      listener = next;
      return () => {
        unsubscribeCount += 1;
      };
    });

    await subscriptions.ensure("runtime-1", (event) => events.push(event));
    await subscriptions.ensure("runtime-1", () => undefined);
    if (!listener) {
      throw new Error("Expected a Codex runtime event listener.");
    }

    listener({
      runtimeId: "runtime-1",
      kind: "server_request",
      receivedAt,
      message: {
        id: "approval-1",
        method: "mcpServer/elicitation/request",
        params: {
          threadId: "child-thread",
          turnId: "child-turn",
          serverName: "openducktor",
          mode: "form",
          message: "Approve workflow tool?",
          requestedSchema: { type: "object", properties: {} },
          _meta: { codex_approval_kind: "mcp_tool_call" },
        },
      },
    });
    listener({
      runtimeId: "runtime-1",
      kind: "notification",
      receivedAt,
      message: {
        method: "serverRequest/resolved",
        params: { threadId: "child-thread", requestId: "approval-1" },
      },
    });

    expect(subscribeCount).toBe(1);
    expect(events.map(threadIdFromRuntimeStreamEvent)).toEqual(["child-thread", "child-thread"]);
    expect(events).toMatchObject([
      { kind: "server_request", message: { method: "mcpServer/elicitation/request" } },
      { kind: "notification", message: { method: "serverRequest/resolved" } },
    ]);

    subscriptions.stop("runtime-1");
    expect(unsubscribeCount).toBe(1);
  });
});
