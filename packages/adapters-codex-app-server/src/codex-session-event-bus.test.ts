import { describe, expect, test } from "bun:test";
import type { AgentEvent, SessionRef } from "@openducktor/core";
import { CodexSessionEventBus } from "./codex-session-event-bus";

type SessionErrorEvent = Extract<AgentEvent, { type: "session_error" }>;

const sessionRef: SessionRef = {
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
  test("does not retain unobserved events for a late renderer subscriber", () => {
    const bus = new CodexSessionEventBus();
    const firstEvents: AgentEvent[] = [];
    const secondEvents: AgentEvent[] = [];

    bus.emit(sessionRef, sessionErrorEvent("offline"));
    bus.subscribe(sessionRef, (event) => firstEvents.push(event));
    bus.subscribe(sessionRef, (event) => secondEvents.push(event));

    expect(firstEvents).toEqual([]);
    expect(secondEvents).toEqual([]);
  });

  test("delivers an event to every subscriber when one subscriber fails", () => {
    const bus = new CodexSessionEventBus();
    const deliveredEvents: AgentEvent[] = [];
    const event = sessionErrorEvent("offline");

    bus.subscribe(sessionRef, () => {
      throw new Error("simulated subscriber failure");
    });
    bus.subscribe(sessionRef, (nextEvent) => deliveredEvents.push(nextEvent));

    expect(() => bus.emit(sessionRef, event)).toThrow("simulated subscriber failure");
    expect(deliveredEvents).toEqual([event]);
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
    const otherRepoSessionRef: SessionRef = {
      ...sessionRef,
      repoPath: "/other-repo",
      workingDirectory: "/other-repo",
    };

    bus.subscribe(otherRepoSessionRef, (event) => otherRepoEvents.push(event));
    bus.emit(sessionRef, sessionErrorEvent("offline"));

    expect(otherRepoEvents).toEqual([]);
  });
});
