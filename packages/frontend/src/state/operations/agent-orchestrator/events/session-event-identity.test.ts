import { describe, expect, test } from "bun:test";
import { sessionRefForStreamEvent } from "./session-event-identity";

describe("agent-orchestrator/events/session-event-identity", () => {
  test("routes stream events by the event session ref inside the stream scope", () => {
    const sessionBRef = {
      externalSessionId: "session-b",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/worktree-b",
      repoPath: "/repo",
    };

    expect(
      sessionRefForStreamEvent(
        {
          externalSessionId: "session-a",
          runtimeKind: "codex",
          workingDirectory: "/repo/worktree-a",
          repoPath: "/repo",
        },
        {
          type: "user_message",
          externalSessionId: "session-b",
          messageId: "user-b",
          message: "Route to session B",
          parts: [{ kind: "text", text: "Route to session B" }],
          state: "read",
          timestamp: "2026-06-12T08:00:01.000Z",
          sessionRef: sessionBRef,
        },
      ),
    ).toEqual(sessionBRef);
  });

  test("rejects cross-session stream events without a full session ref", () => {
    expect(() =>
      sessionRefForStreamEvent(
        {
          externalSessionId: "session-a",
          runtimeKind: "codex",
          workingDirectory: "/repo/worktree-a",
          repoPath: "/repo",
        },
        {
          type: "session_idle",
          externalSessionId: "session-b",
          timestamp: "2026-06-12T08:00:01.000Z",
        },
      ),
    ).toThrow("without a full session ref");
  });

  test("rejects events from another repo stream", () => {
    expect(() =>
      sessionRefForStreamEvent(
        {
          externalSessionId: "session-a",
          runtimeKind: "codex",
          workingDirectory: "/repo/worktree-a",
          repoPath: "/repo",
        },
        {
          type: "session_idle",
          externalSessionId: "session-b",
          timestamp: "2026-06-12T08:00:01.000Z",
          sessionRef: {
            externalSessionId: "session-b",
            runtimeKind: "codex",
            workingDirectory: "/other-repo/worktree-b",
            repoPath: "/other-repo",
          },
        },
      ),
    ).toThrow("belongs to repo");
  });
});
