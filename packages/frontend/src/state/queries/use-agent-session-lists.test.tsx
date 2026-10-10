import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import {
  agentSessionQueryKeys,
  refreshAgentSessionListQuery,
  removeAgentSessionListQueries,
} from "./agent-sessions";
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

type BatchResult = { taskId: string; agentSessions: AgentSessionRecord[] }[];

const deferred = <Value,>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe("useAgentSessionLists", () => {
  test("does not read a deleted task while its session list observer is still mounted", async () => {
    let deleted = false;
    const batchList = mock(async () => {
      if (deleted) throw new Error("Task not found: task-1");
      return [{ taskId: "task-1", agentSessions: [sessionFixture] }];
    });
    const props: HarnessProps = {
      repoPath: "/repo",
      taskIds: ["task-1"],
      enabled: true,
      readPort: { agentSessionsListForTasks: batchList },
    };
    const harness = createHarness(props);

    try {
      await harness.mount();
      await harness.waitFor((state) => !state.isPending);
      expect(batchList).toHaveBeenCalledTimes(1);

      deleted = true;
      await harness.run(async () => {
        await removeAgentSessionListQueries(harness.getQueryClient(), "/repo", ["task-1"]);
      });
      await harness.update(props);

      expect(batchList).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().error).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("stays pending without reading when disabled", async () => {
    const batchList = mock(async () => []);
    const harness = createHarness({
      repoPath: "/repo",
      taskIds: ["task-1"],
      enabled: false,
      readPort: { agentSessionsListForTasks: batchList },
    });

    try {
      await harness.mount();
      expect(harness.getLatest()).toEqual({
        data: { "task-1": [] },
        error: null,
        isPending: true,
      });
      expect(batchList).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("stays pending without reading when no repository is selected", async () => {
    const batchList = mock(async () => []);
    const harness = createHarness({
      repoPath: null,
      taskIds: ["task-1"],
      enabled: true,
      readPort: { agentSessionsListForTasks: batchList },
    });

    try {
      await harness.mount();
      expect(harness.getLatest()).toEqual({
        data: { "task-1": [] },
        error: null,
        isPending: true,
      });
      expect(batchList).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("reads the initial lists in one request and an exact refresh reads only its task", async () => {
    const refreshedSession = { ...sessionFixture, externalSessionId: "external-2" };
    const batchList = mock(async (_repoPath: string, taskIds: string[]): Promise<BatchResult> =>
      batchList.mock.calls.length === 1
        ? [
            { taskId: "task-1", agentSessions: [sessionFixture] },
            { taskId: "task-2", agentSessions: [] },
          ]
        : taskIds.map((taskId) => ({ taskId, agentSessions: [refreshedSession] })),
    );
    const props: HarnessProps = {
      repoPath: "/repo",
      taskIds: ["task-1", "task-2"],
      enabled: true,
      readPort: { agentSessionsListForTasks: batchList },
    };
    const harness = createHarness(props);

    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      await harness.waitFor((state) => !state.isPending);
      expect(batchList.mock.calls).toEqual([["/repo", ["task-1", "task-2"]]]);

      await harness.update({ ...props, taskIds: [] });
      await harness.update(props);
      await harness.waitFor((state) => !state.isPending);
      expect(batchList).toHaveBeenCalledTimes(1);

      await harness.run(async () => {
        await refreshAgentSessionListQuery(queryClient, "/repo", "task-1", {
          agentSessionsListForTasks: batchList,
        });
      });
      expect(batchList.mock.calls[1]).toEqual(["/repo", ["task-1"]]);
      expect(
        queryClient.getQueryData<AgentSessionRecord[]>(
          agentSessionQueryKeys.list("/repo", "task-1"),
        ),
      ).toEqual([refreshedSession]);
    } finally {
      await harness.unmount();
    }
  });

  test("reads a task again when it is refreshed during the initial read", async () => {
    const refreshedSession = { ...sessionFixture, externalSessionId: "external-2" };
    const initialRead = deferred<BatchResult>();
    const batchList = mock(async (_repoPath: string, taskIds: string[]): Promise<BatchResult> =>
      batchList.mock.calls.length === 1
        ? initialRead.promise
        : taskIds.map((taskId) => ({ taskId, agentSessions: [refreshedSession] })),
    );
    const harness = createHarness({
      repoPath: "/repo",
      taskIds: ["task-1", "task-2"],
      enabled: true,
      readPort: { agentSessionsListForTasks: batchList },
    });

    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      await harness.waitFor(() => batchList.mock.calls.length === 1);
      await harness.run(async () => {
        const refresh = refreshAgentSessionListQuery(queryClient, "/repo", "task-1", {
          agentSessionsListForTasks: batchList,
        });
        initialRead.resolve([
          { taskId: "task-1", agentSessions: [sessionFixture] },
          { taskId: "task-2", agentSessions: [] },
        ]);
        await refresh;
      });
      await harness.waitFor((current) => !current.isPending);

      expect(batchList.mock.calls).toEqual([
        ["/repo", ["task-1", "task-2"]],
        ["/repo", ["task-1"]],
      ]);
      expect(harness.getLatest().data).toEqual({
        "task-1": [refreshedSession],
        "task-2": [],
      });
    } finally {
      await harness.unmount();
    }
  });

  test("does not retry a failed exact refresh after the initial read completes", async () => {
    const initialRead = deferred<BatchResult>();
    const batchList = mock(async (): Promise<BatchResult> => {
      if (batchList.mock.calls.length === 1) return initialRead.promise;
      throw new Error("exact refresh failed");
    });
    const harness = createHarness({
      repoPath: "/repo",
      taskIds: ["task-1"],
      enabled: true,
      readPort: { agentSessionsListForTasks: batchList },
    });

    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      await harness.waitFor(() => batchList.mock.calls.length === 1);
      await harness.run(async () => {
        const refresh = refreshAgentSessionListQuery(queryClient, "/repo", "task-1", {
          agentSessionsListForTasks: batchList,
        });
        initialRead.resolve([{ taskId: "task-1", agentSessions: [sessionFixture] }]);
        await expect(refresh).rejects.toThrow("exact refresh failed");
      });
      await harness.waitFor(
        (current) =>
          current.error instanceof Error && current.error.message === "exact refresh failed",
      );

      expect(batchList).toHaveBeenCalledTimes(2);
      expect(harness.getLatest().isPending).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces an exact refresh error without reading the failed list on mount", async () => {
    const batchList = mock(async () => {
      throw new Error("exact refresh failed before mount");
    });
    const props: HarnessProps = {
      repoPath: "/repo",
      taskIds: ["task-1"],
      enabled: false,
      readPort: { agentSessionsListForTasks: batchList },
    };
    const harness = createHarness(props);

    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      await harness.run(async () => {
        await expect(
          refreshAgentSessionListQuery(queryClient, "/repo", "task-1", {
            agentSessionsListForTasks: batchList,
          }),
        ).rejects.toThrow("exact refresh failed before mount");
      });
      await harness.update({ ...props, enabled: true });
      await harness.waitFor(
        (current) =>
          current.error instanceof Error &&
          current.error.message === "exact refresh failed before mount",
      );

      expect(batchList).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().isPending).toBe(false);
    } finally {
      await harness.unmount();
    }
  });
});
