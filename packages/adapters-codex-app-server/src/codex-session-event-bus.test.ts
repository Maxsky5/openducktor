import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { CodexSessionEventBus } from "./codex-session-event-bus";

type SessionErrorEvent = Extract<AgentEvent, { type: "session_error" }>;

const sessionErrorEvent = (message: string): SessionErrorEvent => ({
  type: "session_error",
  externalSessionId: "thread-1",
  timestamp: "2026-06-13T00:00:00.000Z",
  message,
});

describe("CodexSessionEventBus", () => {
  test("replays buffered non-pending events to a late subscriber once", () => {
    const bus = new CodexSessionEventBus();
    const firstEvents: AgentEvent[] = [];
    const secondEvents: AgentEvent[] = [];

    bus.emit("thread-1", sessionErrorEvent("offline"));
    bus.subscribe("thread-1", (event) => firstEvents.push(event));
    bus.subscribe("thread-1", (event) => secondEvents.push(event));

    expect(firstEvents.map((event) => event.type)).toEqual(["session_error"]);
    expect(secondEvents).toEqual([]);
  });

  test("does not backlog pending input because presence owns its current state", () => {
    const bus = new CodexSessionEventBus();
    const events: AgentEvent[] = [];

    bus.emit("thread-1", {
      type: "approval_required",
      externalSessionId: "thread-1",
      timestamp: "2026-06-13T00:00:00.000Z",
      requestId: "approval-1",
      requestType: "permission_grant",
      title: "Approve read",
    });
    bus.subscribe("thread-1", (event) => events.push(event));

    expect(events).toEqual([]);
  });
});
