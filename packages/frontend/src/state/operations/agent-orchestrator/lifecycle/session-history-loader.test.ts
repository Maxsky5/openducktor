import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionTodoItem } from "@openducktor/core";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { loadSessionHistorySnapshot } from "./session-history-loader";

const sessionTarget = {
  externalSessionId: "external-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  selectedModel: null,
} satisfies Parameters<typeof loadSessionHistorySnapshot>[0]["session"];

const createSession = (): AgentSessionState =>
  createAgentSessionFixture({
    externalSessionId: sessionTarget.externalSessionId,
    taskId: "task-1",
    repoPath: "/repo",
    runtimeKind: "opencode",
    role: "build",
    status: "running",
    startedAt: "2026-06-12T08:00:00.000Z",
    workingDirectory: sessionTarget.workingDirectory,
    historyLoadState: "not_requested",
  });

describe("session history loader", () => {
  test("treats a stale operation as neither applied nor failed", async () => {
    const loadSessionHistory = mock(async () => []);
    const updateSession = mock(() => undefined);

    const result = await loadSessionHistorySnapshot({
      repoPath: "/repo",
      adapter: { loadSessionHistory },
      updateSession,
      session: sessionTarget,
      isStaleRepoOperation: () => true,
    });

    expect(result).toEqual({
      externalSessionId: sessionTarget.externalSessionId,
      status: "stale",
    });
    expect(loadSessionHistory).not.toHaveBeenCalled();
    expect(updateSession).not.toHaveBeenCalled();
  });

  test("marks the session failed when history loading fails for the current repo operation", async () => {
    let session = createSession();

    const result = await loadSessionHistorySnapshot({
      repoPath: "/repo",
      adapter: {
        loadSessionHistory: async () => {
          throw new Error("history unavailable");
        },
      },
      updateSession: (_externalSessionId, updater) => {
        session = updater(session);
      },
      session: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(result.status).toBe("failed");
    expect(session.historyLoadState).toBe("failed");
  });

  test("loads transcript history without owning todo hydration", async () => {
    const existingTodos: AgentSessionTodoItem[] = [
      {
        id: "todo-1",
        content: "Keep visible todo",
        status: "in_progress",
        priority: "medium",
      },
    ];
    let session = createSession();
    session = { ...session, todos: existingTodos };

    const result = await loadSessionHistorySnapshot({
      repoPath: "/repo",
      adapter: {
        loadSessionHistory: async () => [],
      },
      updateSession: (_externalSessionId, updater) => {
        session = updater(session);
      },
      session: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(result.status).toBe("applied");
    expect(session.historyLoadState).toBe("loaded");
    expect(session.todos).toBe(existingTodos);
  });
});
