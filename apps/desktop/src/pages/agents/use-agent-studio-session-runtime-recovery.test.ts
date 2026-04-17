import { describe, expect, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  buildSelectedSessionRuntimeRecoverySignal,
  refreshSelectedSessionRuntimeRecoverySources,
} from "./use-agent-studio-session-runtime-recovery";

describe("buildSelectedSessionRuntimeRecoverySignal", () => {
  test("includes matching runtime instances for the selected session", () => {
    const signal = buildSelectedSessionRuntimeRecoverySignal({
      activeTaskId: "task-1",
      session: {
        role: "build",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree-a",
      },
      runs: [],
      runtimes: [
        {
          kind: "opencode",
          runtimeId: "runtime-1",
          workingDirectory: "/repo/worktree-a",
          route: "http://127.0.0.1:4444",
        },
      ],
    });

    expect(signal).toContain("runtime-1");
  });

  test("ignores unrelated repo-wide runs and runtimes", () => {
    const baseline = buildSelectedSessionRuntimeRecoverySignal({
      activeTaskId: "task-1",
      session: {
        role: "build",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree-a",
      },
      runs: [
        {
          runId: "run-1",
          taskId: "task-1",
          state: "running",
          worktreePath: "/repo/worktree-a",
          runtimeKind: "opencode",
          runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
          repoPath: "/repo",
          branch: "task-1",
          port: 4444,
          lastMessage: null,
          startedAt: "2026-02-22T08:00:00.000Z",
        },
      ],
      runtimes: [],
    });

    const withUnrelatedChanges = buildSelectedSessionRuntimeRecoverySignal({
      activeTaskId: "task-1",
      session: {
        role: "build",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree-a",
      },
      runs: [
        {
          runId: "run-1",
          taskId: "task-1",
          state: "running",
          worktreePath: "/repo/worktree-a",
          runtimeKind: "opencode",
          runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
          repoPath: "/repo",
          branch: "task-1",
          port: 4444,
          lastMessage: null,
          startedAt: "2026-02-22T08:00:00.000Z",
        },
        {
          runId: "run-unrelated",
          taskId: "task-99",
          state: "running",
          worktreePath: "/repo/worktree-z",
          runtimeKind: "opencode",
          runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:5555" },
          repoPath: "/repo",
          branch: "task-99",
          port: 5555,
          lastMessage: null,
          startedAt: "2026-02-22T08:05:00.000Z",
        },
      ],
      runtimes: [
        {
          kind: "opencode",
          runtimeId: "runtime-unrelated",
          workingDirectory: "/repo/worktree-z",
          route: "http://127.0.0.1:5555",
        },
      ],
    });

    expect(withUnrelatedChanges).toBe(baseline);
  });

  test("refreshes repo task data alongside runtime lists", async () => {
    const queryClient = new QueryClient();
    const fetchQuery = mock(async () => ({ tasks: [], runs: [] }));
    queryClient.fetchQuery = fetchQuery as typeof queryClient.fetchQuery;
    const refetchRuntimeList = mock(async () => []);

    await refreshSelectedSessionRuntimeRecoverySources({
      queryClient,
      repoPath: "/repo",
      refetchRuntimeLists: [refetchRuntimeList],
    });

    expect(fetchQuery).toHaveBeenCalledTimes(1);
    expect(refetchRuntimeList).toHaveBeenCalledTimes(1);
  });
});
