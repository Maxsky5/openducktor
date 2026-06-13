import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  loadRequestedSessionHistorySnapshot,
  loadSessionHistorySnapshot,
} from "./session-history-loader";

const record: AgentSessionRecord = {
  externalSessionId: "external-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  startedAt: "2026-06-12T08:00:00.000Z",
  selectedModel: null,
};

const createSession = (): AgentSessionState =>
  createAgentSessionFixture({
    externalSessionId: record.externalSessionId,
    taskId: "task-1",
    repoPath: "/repo",
    runtimeKind: "opencode",
    role: "build",
    status: "running",
    startedAt: record.startedAt,
    workingDirectory: record.workingDirectory,
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
      record,
      isStaleRepoOperation: () => true,
    });

    expect(result).toEqual({
      externalSessionId: record.externalSessionId,
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
      record,
      isStaleRepoOperation: () => false,
    });

    expect(result.status).toBe("failed");
    expect(session.historyLoadState).toBe("failed");
  });

  test("does not throw an unknown-session error after the repo operation becomes stale", async () => {
    let staleCheckCount = 0;

    await expect(
      loadRequestedSessionHistorySnapshot({
        repoPath: "/repo",
        adapter: { loadSessionHistory: async () => [] },
        updateSession: () => undefined,
        records: [],
        externalSessionId: record.externalSessionId,
        isStaleRepoOperation: () => {
          staleCheckCount += 1;
          return staleCheckCount > 1;
        },
      }),
    ).resolves.toBeUndefined();
  });
});
