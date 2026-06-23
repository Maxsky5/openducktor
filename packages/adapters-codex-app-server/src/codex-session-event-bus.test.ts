import { describe, expect, test } from "bun:test";
import type { AgentEvent, AgentSessionRef } from "@openducktor/core";
import { CodexSessionEventBus } from "./codex-session-event-bus";

type SessionErrorEvent = Extract<AgentEvent, { type: "session_error" }>;

const sessionRef: AgentSessionRef = {
  externalSessionId: "thread-1",
  repoPath: "/repo",
  runtimeKind: "codex",
  workingDirectory: "/repo",
};

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

    bus.emit(sessionRef, sessionErrorEvent("offline"));
    bus.subscribe(sessionRef, (event) => firstEvents.push(event));
    bus.subscribe(sessionRef, (event) => secondEvents.push(event));

    expect(firstEvents.map((event) => event.type)).toEqual(["session_error"]);
    expect(secondEvents).toEqual([]);
  });

  test("does not backlog pending input because runtime snapshot owns its current state", () => {
    const bus = new CodexSessionEventBus();
    const events: AgentEvent[] = [];

    bus.emit(sessionRef, {
      type: "approval_required",
      externalSessionId: "thread-1",
      timestamp: "2026-06-13T00:00:00.000Z",
      requestId: "approval-1",
      requestType: "permission_grant",
      title: "Approve read",
    });
    bus.subscribe(sessionRef, (event) => events.push(event));

    expect(events).toEqual([]);
  });

  test("does not deliver events to a listener for the same external id in another repo", () => {
    const bus = new CodexSessionEventBus();
    const otherRepoEvents: AgentEvent[] = [];
    const otherRepoSessionRef: AgentSessionRef = {
      ...sessionRef,
      repoPath: "/other-repo",
      workingDirectory: "/other-repo",
    };

    bus.subscribe(otherRepoSessionRef, (event) => otherRepoEvents.push(event));
    bus.emit(sessionRef, sessionErrorEvent("offline"));

    expect(otherRepoEvents).toEqual([]);
  });
});
