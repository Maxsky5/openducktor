import { describe, expect, test } from "bun:test";
import { toPresenceSnapshot } from "./codex-app-server-presence";
import type { CodexSessionState } from "./types";

describe("toPresenceSnapshot", () => {
  test("uses a neutral Codex title when the session role is absent", () => {
    const session: CodexSessionState = {
      summary: {
        externalSessionId: "thread-1",
        role: null,
        startedAt: "2026-05-07T00:00:00.000Z",
        status: "running",
      },
      systemPrompt: "Use the repo rules.",
      role: null,
      runtimeId: "runtime-1",
      repoPath: "/repo",
      threadId: "thread-1",
      workingDirectory: "/repo",
      taskId: "task-1",
    };

    expect(toPresenceSnapshot(session, [], [])).toMatchObject({ title: "Codex" });
  });
});
