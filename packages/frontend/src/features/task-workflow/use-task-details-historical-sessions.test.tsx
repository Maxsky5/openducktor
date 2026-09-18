import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { type AgentSessionReadPort, agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { withMockedToast } from "@/test-utils/mock-toast";
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

const createFailingReadPort = (): AgentSessionReadPort => ({
  agentSessionsList: async () => {
    throw new Error("agent session list unavailable");
  },
  agentSessionsListForTasks: async () => {
    throw new Error("agent session list unavailable");
  },
});

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

  test("reports a session list read failure", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const harness = createHarness(
      {
        repoPath: "/repo-a",
        taskId: "task-1",
        enabled: true,
        readPort: createFailingReadPort(),
      },
      queryClient,
    );

    try {
      await withMockedToast(async ({ toastErrorMock }) => {
        await harness.mount();
        await harness.run(() => {});
        await waitFor(() => {
          expect(toastErrorMock).toHaveBeenCalled();
        });
        expect(toastErrorMock).toHaveBeenCalledWith("Failed to load task session history", {
          id: "task-session-history-error:/repo-a:task-1",
          description: "agent session list unavailable",
        });
      });
    } finally {
      await harness.unmount();
      queryClient.clear();
    }
  });

  test("reports failures for different tasks separately", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const readPort = createFailingReadPort();
    const harness = createHarness(
      { repoPath: "/repo-a", taskId: "task-1", enabled: true, readPort },
      queryClient,
    );

    try {
      await withMockedToast(async ({ toastErrorMock }) => {
        await harness.mount();
        await harness.run(() => {});
        await waitFor(() => {
          expect(toastErrorMock).toHaveBeenCalledTimes(1);
        });

        await harness.update({ repoPath: "/repo-a", taskId: "task-2", enabled: true, readPort });
        await waitFor(() => {
          expect(toastErrorMock).toHaveBeenCalledTimes(2);
        });
        expect(toastErrorMock).toHaveBeenNthCalledWith(2, "Failed to load task session history", {
          id: "task-session-history-error:/repo-a:task-2",
          description: "agent session list unavailable",
        });
      });
    } finally {
      await harness.unmount();
      queryClient.clear();
    }
  });
});
