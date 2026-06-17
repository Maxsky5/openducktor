import { describe, expect, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "./messages";
import { toRuntimeSessionRef } from "./session-runtime-ref";

const sessionFixture = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  externalSessionId: "session-1",
  taskId: "task-1",
  runtimeKind: "codex",
  role: "build",
  status: "idle",
  startedAt: "2026-02-22T08:00:00.000Z",
  workingDirectory: "/repo/worktree",
  messages: createSessionMessagesState(overrides.externalSessionId ?? "session-1"),
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: null,
  historyLoadState: "not_requested",
  ...overrides,
});

describe("runtime session refs", () => {
  test("builds session refs from mandatory session runtime fields", () => {
    expect(
      toRuntimeSessionRef(" /repo ", sessionFixture({ workingDirectory: " /repo/wt " })),
    ).toEqual({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo/wt",
      externalSessionId: "session-1",
    });
  });

  test("fails fast when a session working directory is missing", () => {
    expect(() => toRuntimeSessionRef("/repo", sessionFixture({ workingDirectory: " " }))).toThrow(
      "Session workingDirectory is required to reach session 'session-1'.",
    );
  });
});
