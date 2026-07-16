import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { agentSessionQueryKeys, refreshAgentSessionListQuery } from "./agent-sessions";
import { useAgentSessionLists } from "./use-agent-session-lists";

const sessionFixture: AgentSessionRecord = {
  externalSessionId: "external-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/tmp/repo/worktree",
  startedAt: "2026-03-22T12:00:00.000Z",
  selectedModel: null,
};

type HarnessProps = Omit<Parameters<typeof useAgentSessionLists>[0], "queryClient">;

const createHarness = (initialProps: HarnessProps) => {
  let queryClient: QueryClient | null = null;
  const harness = createHookHarness(
    (props: HarnessProps) => {
      queryClient = useQueryClient();
      return useAgentSessionLists({ ...props, queryClient });
    },
    initialProps,
    { wrapper: IsolatedQueryWrapper },
  );

  return {
    ...harness,
    getQueryClient: (): QueryClient => {
      if (!queryClient) {
        throw new Error("Query client unavailable before harness mount");
      }
      return queryClient;
    },
  };
};

describe("useAgentSessionLists", () => {
  test("stays pending without reading when disabled", async () => {
    const batchList = mock(async () => []);
    const singleList = mock(async () => []);
    const harness = createHarness({
      repoPath: "/repo",
      taskIds: ["task-1"],
      enabled: false,
      readPort: {
        agentSessionsList: singleList,
        agentSessionsListForTasks: batchList,
      },
    });

    try {
      await harness.mount();
      expect(harness.getLatest()).toEqual({
        data: { "task-1": [] },
        error: null,
        isPending: true,
      });
      expect(batchList).not.toHaveBeenCalled();
      expect(singleList).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("stays pending without reading when no repository is selected", async () => {
    const batchList = mock(async () => []);
    const singleList = mock(async () => []);
    const harness = createHarness({
      repoPath: null,
      taskIds: ["task-1"],
      enabled: true,
      readPort: {
        agentSessionsList: singleList,
        agentSessionsListForTasks: batchList,
      },
    });

    try {
      await harness.mount();
      expect(harness.getLatest()).toEqual({
        data: { "task-1": [] },
        error: null,
        isPending: true,
      });
      expect(batchList).not.toHaveBeenCalled();
      expect(singleList).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("batches initial missing tasks once and leaves exact invalidation to the per-task query", async () => {
    const refreshedSession = { ...sessionFixture, externalSessionId: "external-2" };
    const batchList = mock(async () => [
      { taskId: "task-1", agentSessions: [sessionFixture] },
      { taskId: "task-2", agentSessions: [] },
    ]);
    const singleList = mock(async (_repoPath: string, _taskId: string) => [refreshedSession]);
    const props: HarnessProps = {
      repoPath: "/repo",
      taskIds: ["task-1", "task-2"],
      enabled: true,
      readPort: {
        agentSessionsList: singleList,
        agentSessionsListForTasks: batchList,
      },
    };
    const harness = createHarness(props);

    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      await harness.waitFor((state) => !state.isPending);
      expect(batchList).toHaveBeenCalledTimes(1);
      expect(singleList).not.toHaveBeenCalled();

      await harness.update({ ...props, taskIds: [] });
      for (const taskId of ["task-1", "task-2"]) {
        const queryKey = agentSessionQueryKeys.list("/repo", taskId);
        queryClient.setQueryData(queryKey, queryClient.getQueryData(queryKey), { updatedAt: 1 });
      }

      await harness.update(props);
      await harness.waitFor((state) => !state.isPending);
      expect(batchList).toHaveBeenCalledTimes(1);
      expect(singleList).not.toHaveBeenCalled();

      await harness.run(async () => {
        await refreshAgentSessionListQuery(queryClient, "/repo", "task-1", {
          agentSessionsList: singleList,
        });
      });
      expect(singleList).toHaveBeenCalledTimes(1);
      expect(singleList).toHaveBeenCalledWith("/repo", "task-1");
      expect(
        queryClient.getQueryData<AgentSessionRecord[]>(
          agentSessionQueryKeys.list("/repo", "task-1"),
        ),
      ).toEqual([refreshedSession]);
      expect(batchList).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("refetches only a task invalidated during initial batch hydration", async () => {
    const refreshedSession = { ...sessionFixture, externalSessionId: "external-2" };
    let resolveInitialBatch: (
      value: { taskId: string; agentSessions: AgentSessionRecord[] }[],
    ) => void = () => {
      throw new Error("Initial batch resolver was not initialized.");
    };
    const batchList = mock(
      async (_repoPath: string, _taskIds: string[]) =>
        new Promise<{ taskId: string; agentSessions: AgentSessionRecord[] }[]>((resolve) => {
          resolveInitialBatch = resolve;
        }),
    );
    const singleList = mock(async (_repoPath: string, _taskId: string) => [refreshedSession]);
    const harness = createHarness({
      repoPath: "/repo",
      taskIds: ["task-1", "task-2"],
      enabled: true,
      readPort: {
        agentSessionsList: singleList,
        agentSessionsListForTasks: batchList,
      },
    });

    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      await harness.waitFor(() => batchList.mock.calls.length === 1);
      await harness.run(async () => {
        await refreshAgentSessionListQuery(queryClient, "/repo", "task-1", {
          agentSessionsList: singleList,
        });
        resolveInitialBatch([
          { taskId: "task-1", agentSessions: [sessionFixture] },
          { taskId: "task-2", agentSessions: [] },
        ]);
      });
      await harness.waitFor(
        (current) =>
          !current.isPending && current.data["task-1"]?.[0]?.externalSessionId === "external-2",
      );
      const state = harness.getLatest();

      expect(batchList).toHaveBeenCalledTimes(1);
      expect(singleList).toHaveBeenCalledTimes(1);
      expect(singleList).toHaveBeenCalledWith("/repo", "task-1");
      expect(batchList.mock.calls[0]).toEqual(["/repo", ["task-1", "task-2"]]);
      expect(state.data).toEqual({
        "task-1": [refreshedSession],
        "task-2": [],
      });
    } finally {
      await harness.unmount();
    }
  });

  test("does not retry a failed exact refetch when startup hydration enables the task query", async () => {
    let resolveInitialBatch: (
      value: { taskId: string; agentSessions: AgentSessionRecord[] }[],
    ) => void = () => {
      throw new Error("Initial batch resolver was not initialized.");
    };
    const batchList = mock(
      async (_repoPath: string, _taskIds: string[]) =>
        new Promise<{ taskId: string; agentSessions: AgentSessionRecord[] }[]>((resolve) => {
          resolveInitialBatch = resolve;
        }),
    );
    const singleList = mock(async (_repoPath: string, _taskId: string) => {
      throw new Error("exact refresh failed");
    });
    const harness = createHarness({
      repoPath: "/repo",
      taskIds: ["task-1"],
      enabled: true,
      readPort: {
        agentSessionsList: singleList,
        agentSessionsListForTasks: batchList,
      },
    });

    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      await harness.waitFor(() => batchList.mock.calls.length === 1);
      await harness.run(async () => {
        await expect(
          refreshAgentSessionListQuery(queryClient, "/repo", "task-1", {
            agentSessionsList: singleList,
          }),
        ).rejects.toThrow("exact refresh failed");
        resolveInitialBatch([{ taskId: "task-1", agentSessions: [sessionFixture] }]);
      });
      await harness.waitFor(
        (current) =>
          current.error instanceof Error && current.error.message === "exact refresh failed",
      );

      expect(batchList).toHaveBeenCalledTimes(1);
      expect(singleList).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().isPending).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces an exact refresh error without batch-hydrating the failed query", async () => {
    const batchList = mock(async () => [{ taskId: "task-1", agentSessions: [sessionFixture] }]);
    const singleList = mock(async () => {
      throw new Error("exact refresh failed before mount");
    });
    const props: HarnessProps = {
      repoPath: "/repo",
      taskIds: ["task-1"],
      enabled: false,
      readPort: {
        agentSessionsList: singleList,
        agentSessionsListForTasks: batchList,
      },
    };
    const harness = createHarness(props);

    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      await harness.run(async () => {
        await expect(
          refreshAgentSessionListQuery(queryClient, "/repo", "task-1", {
            agentSessionsList: singleList,
          }),
        ).rejects.toThrow("exact refresh failed before mount");
      });
      await harness.update({ ...props, enabled: true });
      await harness.waitFor(
        (current) =>
          current.error instanceof Error &&
          current.error.message === "exact refresh failed before mount",
      );

      expect(batchList).not.toHaveBeenCalled();
      expect(singleList).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().isPending).toBe(false);
    } finally {
      await harness.unmount();
    }
  });
});
