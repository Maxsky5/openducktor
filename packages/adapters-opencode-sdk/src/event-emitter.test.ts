import { describe, expect, test } from "bun:test";
import type { AgentEvent, SessionRef } from "@openducktor/core";
import {
  clearSessionListeners,
  emitSessionEvent,
  type SessionEventListeners,
  subscribeSessionEvents,
} from "./event-emitter";

const sessionRef: SessionRef = {
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
    const otherRepoSessionRef: SessionRef = {
      ...sessionRef,
      repoPath: "/other-repo",
      workingDirectory: "/other-repo",
    };

    subscribeSessionEvents(listeners, otherRepoSessionRef, (event) => received.push(event));
    emitSessionEvent(listeners, sessionRef, sessionErrorEvent);

    expect(received).toEqual([]);
  });

  test("clears listeners by full session ref", () => {
    const listeners: SessionEventListeners = new Map();
    const received: AgentEvent[] = [];
    const otherWorkingDirectorySessionRef: SessionRef = {
      ...sessionRef,
      workingDirectory: "/repo/worktrees/session-1",
    };

    subscribeSessionEvents(listeners, sessionRef, (event) => received.push(event));
    subscribeSessionEvents(listeners, otherWorkingDirectorySessionRef, (event) =>
      received.push(event),
    );

    clearSessionListeners(listeners, sessionRef);
    emitSessionEvent(listeners, sessionRef, sessionErrorEvent);
    emitSessionEvent(listeners, otherWorkingDirectorySessionRef, {
      ...sessionErrorEvent,
      sessionRef: otherWorkingDirectorySessionRef,
    });

    expect(received).toEqual([
      { ...sessionErrorEvent, sessionRef: otherWorkingDirectorySessionRef },
    ]);
  });
});
