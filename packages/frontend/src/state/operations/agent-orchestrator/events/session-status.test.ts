import { describe, expect, test } from "bun:test";
import {
  buildSession,
  createSessionsRef,
  createSessionUpdater,
  getSession,
  listenToAgentSessionEvents,
  type SessionEventAdapter,
} from "./session-events-test-harness";

type RoutedEvent = { type: string; [key: string]: unknown };

const observeSession = async (session = buildSession()) => {
  let handleEvent: ((event: RoutedEvent) => void) | undefined;
  const adapter: SessionEventAdapter = {
    subscribeEvents: async (_externalSessionId, handler) => {
      handleEvent = handler as unknown as (event: RoutedEvent) => void;
      return () => {};
    },
    replyApproval: async () => {},
  };
  const sessionsRef = createSessionsRef([session]);

  await listenToAgentSessionEvents({
    adapter,
    repoPath: "/tmp/repo",
    externalSessionId: session.externalSessionId,
    sessionsRef,
    updateSession: createSessionUpdater(sessionsRef),
    recordTurnActivityTimestamp: () => {},
    resolveTurnDurationMs: () => undefined,
    clearTurnDuration: () => {},
    refreshTaskData: async () => {},
  });

  if (!handleEvent) {
    throw new Error("Expected session event handler to be registered");
  }
  return { handleEvent, sessionsRef };
};

const safetyBufferingStatus = {
  type: "session_status",
  externalSessionId: "session-1",
  status: {
    type: "busy",
    message: "Our systems are thinking a bit more about this request before responding.",
  },
  timestamp: "2026-07-10T10:00:00.000Z",
};

describe("agent-orchestrator session status", () => {
  test("keeps a busy message until the runtime hides it or the session becomes idle", async () => {
    const { handleEvent, sessionsRef } = await observeSession();

    handleEvent(safetyBufferingStatus);
    handleEvent({
      ...safetyBufferingStatus,
      status: { type: "busy" },
      timestamp: "2026-07-10T10:00:01.000Z",
    });
    expect(getSession(sessionsRef).runtimeStatusMessage).toBe(safetyBufferingStatus.status.message);

    handleEvent({
      ...safetyBufferingStatus,
      status: { type: "busy", message: null },
      timestamp: "2026-07-10T10:00:02.000Z",
    });
    expect(getSession(sessionsRef).runtimeStatusMessage).toBeNull();

    handleEvent(safetyBufferingStatus);
    handleEvent({
      type: "session_status",
      externalSessionId: "session-1",
      status: { type: "idle" },
      timestamp: "2026-07-10T10:00:03.000Z",
    });
    expect(getSession(sessionsRef).runtimeStatusMessage).toBeNull();
  });

  test("clears the message on terminal session events", async () => {
    const terminalEvents: RoutedEvent[] = [
      {
        type: "session_error",
        externalSessionId: "session-1",
        message: "Turn failed",
        timestamp: "2026-07-10T10:00:01.000Z",
      },
      {
        type: "session_finished",
        externalSessionId: "session-1",
        timestamp: "2026-07-10T10:00:01.000Z",
      },
    ];

    for (const terminalEvent of terminalEvents) {
      const { handleEvent, sessionsRef } = await observeSession();
      handleEvent(safetyBufferingStatus);
      handleEvent(terminalEvent);
      expect(getSession(sessionsRef).runtimeStatusMessage).toBeNull();
    }
  });

  test("clears a stale message when a session starts again", async () => {
    const { handleEvent, sessionsRef } = await observeSession(
      buildSession({ runtimeStatusMessage: safetyBufferingStatus.status.message }),
    );

    handleEvent({
      type: "session_started",
      externalSessionId: "session-1",
      message: "Session started",
      timestamp: "2026-07-10T10:00:01.000Z",
    });

    expect(getSession(sessionsRef).runtimeStatusMessage).toBeNull();
  });
});
