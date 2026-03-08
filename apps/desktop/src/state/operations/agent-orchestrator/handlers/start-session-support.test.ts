import { describe, expect, test } from "bun:test";
import type { StartedSessionContext } from "./start-session.types";
import {
  compareBySessionRecency,
  createSessionStartTags,
  pickLatestSession,
} from "./start-session-support";

describe("agent-orchestrator/handlers/start-session-support", () => {
  test("compareBySessionRecency sorts newer startedAt values first", () => {
    const older = { startedAt: "2026-02-22T08:00:00.000Z", sessionId: "session-1" };
    const newer = { startedAt: "2026-02-22T08:10:00.000Z", sessionId: "session-2" };

    expect(compareBySessionRecency(newer, older)).toBeLessThan(0);
    expect(compareBySessionRecency(older, newer)).toBeGreaterThan(0);
  });

  test("compareBySessionRecency uses sessionId descending as tie-breaker", () => {
    const sameTimeA = { startedAt: "2026-02-22T08:00:00.000Z", sessionId: "session-a" };
    const sameTimeB = { startedAt: "2026-02-22T08:00:00.000Z", sessionId: "session-b" };

    expect(compareBySessionRecency(sameTimeB, sameTimeA)).toBeLessThan(0);
    expect(compareBySessionRecency(sameTimeA, sameTimeB)).toBeGreaterThan(0);
    expect(compareBySessionRecency(sameTimeA, sameTimeA)).toBe(0);
  });

  test("pickLatestSession returns undefined for empty input", () => {
    expect(pickLatestSession([])).toBeUndefined();
  });

  test("pickLatestSession returns the most recent entry and keeps input order intact", () => {
    const sessions = [
      { startedAt: "2026-02-22T08:00:00.000Z", sessionId: "session-a", marker: "first" },
      { startedAt: "2026-02-22T08:10:00.000Z", sessionId: "session-b", marker: "second" },
      { startedAt: "2026-02-22T08:05:00.000Z", sessionId: "session-c", marker: "third" },
    ];

    const latest = pickLatestSession(sessions);

    expect(latest?.sessionId).toBe("session-b");
    expect(latest?.marker).toBe("second");
    expect(sessions.map((entry) => entry.sessionId)).toEqual([
      "session-a",
      "session-b",
      "session-c",
    ]);
  });

  test("pickLatestSession applies tie-breaker when startedAt values are equal", () => {
    const sessions = [
      { startedAt: "2026-02-22T08:00:00.000Z", sessionId: "session-a" },
      { startedAt: "2026-02-22T08:00:00.000Z", sessionId: "session-b" },
    ];

    const latest = pickLatestSession(sessions);

    expect(latest?.sessionId).toBe("session-b");
  });

  test("createSessionStartTags maps context fields into workflow tag payload", () => {
    const startedCtx: StartedSessionContext = {
      repoPath: "/tmp/repo",
      taskId: "task-1",
      role: "build",
      isStaleRepoOperation: () => false,
      resolvedScenario: "build_implementation_start",
      summary: {
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        role: "build",
        scenario: "build_implementation_start",
        startedAt: "2026-02-22T08:00:10.000Z",
        status: "idle",
      },
    };

    expect(createSessionStartTags(startedCtx)).toEqual({
      repoPath: "/tmp/repo",
      taskId: "task-1",
      role: "build",
      scenario: "build_implementation_start",
      sessionId: "session-1",
    });
  });
});
