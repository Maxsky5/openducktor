import { describe, expect, test } from "bun:test";
import type { AgentEvent, AgentSessionRef } from "@openducktor/core";
import {
  emitSessionEvent,
  type SessionEventListeners,
  subscribeSessionEvents,
} from "./event-emitter";

const sessionRef: AgentSessionRef = {
  externalSessionId: "session-1",
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo",
};

const sessionErrorEvent: AgentEvent = {
  type: "session_error",
  externalSessionId: sessionRef.externalSessionId,
  timestamp: "2026-06-22T00:00:00.000Z",
  message: "offline",
};

describe("OpenCode session event emitter", () => {
  test("does not deliver events to a listener for the same external id in another repo", () => {
    const listeners: SessionEventListeners = new Map();
    const received: AgentEvent[] = [];
    const otherRepoSessionRef: AgentSessionRef = {
      ...sessionRef,
      repoPath: "/other-repo",
      workingDirectory: "/other-repo",
    };

    subscribeSessionEvents(listeners, otherRepoSessionRef, (event) => received.push(event));
    emitSessionEvent(listeners, sessionRef, sessionErrorEvent);

    expect(received).toEqual([]);
  });
});
