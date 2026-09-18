import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type PropsWithChildren } from "react";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { useTaskDetailsHistoricalSessions } from "./use-task-details-historical-sessions";

const sessionFixture: AgentSessionRecord = {
  externalSessionId: "external-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/tmp/repo/worktree",
  startedAt: "2026-03-22T12:00:00.000Z",
  selectedModel: null,
};

type HarnessProps = Parameters<typeof useTaskDetailsHistoricalSessions>[0];

const createHarness = (initialProps: HarnessProps, queryClient: QueryClient) =>
  createHookHarness(useTaskDetailsHistoricalSessions, initialProps, {
    wrapper: ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });

describe("useTaskDetailsHistoricalSessions", () => {
  test("returns the scoped session list for the task", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo-a", "task-1"), [sessionFixture]);
    const harness = createHarness(
      { repoPath: "/repo-a", taskId: "task-1", enabled: true },
      queryClient,
    );

    try {
      await harness.mount();
      expect(harness.getLatest()).toEqual([sessionFixture]);
    } finally {
      await harness.unmount();
      queryClient.clear();
    }
  });

  test("returns no records when disabled or without a task", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo-a", "task-1"), [sessionFixture]);
    const harness = createHarness(
      { repoPath: "/repo-a", taskId: "task-1", enabled: false },
      queryClient,
    );

    try {
      await harness.mount();
      expect(harness.getLatest()).toEqual([]);

      await harness.update({ repoPath: "/repo-a", taskId: null, enabled: true });
      expect(harness.getLatest()).toEqual([]);

      await harness.update({ repoPath: "/repo-a", taskId: "task-1", enabled: true });
      expect(harness.getLatest()).toEqual([sessionFixture]);
    } finally {
      await harness.unmount();
      queryClient.clear();
    }
  });
});
