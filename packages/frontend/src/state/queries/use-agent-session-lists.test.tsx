import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { host } from "../operations/host";
import { agentSessionQueryKeys, invalidateAgentSessionListQuery } from "./agent-sessions";
import { useAgentSessionLists } from "./use-agent-session-lists";

const sessionFixture: AgentSessionRecord = {
  externalSessionId: "external-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/tmp/repo/worktree",
  startedAt: "2026-03-22T12:00:00.000Z",
  selectedModel: null,
};

describe("useAgentSessionLists", () => {
  test("batches initial missing tasks once and leaves exact invalidation to the per-task query", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const refreshedSession = { ...sessionFixture, externalSessionId: "external-2" };
    const batchList = mock(async () => [
      { taskId: "task-1", agentSessions: [sessionFixture] },
      { taskId: "task-2", agentSessions: [] },
    ]);
    const singleList = mock(async () => [refreshedSession]);
    const originalBatchList = host.agentSessionsListForTasks;
    const originalSingleList = host.agentSessionsList;
    host.agentSessionsListForTasks = batchList;
    host.agentSessionsList = singleList;
    const harness = createHookHarness(
      () =>
        useAgentSessionLists({
          repoPath: "/repo",
          taskIds: ["task-1", "task-2"],
          enabled: true,
          queryClient,
        }),
      undefined,
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => !state.isPending);
      expect(batchList).toHaveBeenCalledTimes(1);
      expect(singleList).not.toHaveBeenCalled();

      await harness.unmount();
      for (const taskId of ["task-1", "task-2"]) {
        const queryKey = agentSessionQueryKeys.list("/repo", taskId);
        queryClient.setQueryData(queryKey, queryClient.getQueryData(queryKey), { updatedAt: 1 });
      }

      await harness.mount();
      await harness.waitFor((state) => !state.isPending);
      expect(batchList).toHaveBeenCalledTimes(1);
      expect(singleList).not.toHaveBeenCalled();

      await harness.run(async () => {
        await invalidateAgentSessionListQuery(queryClient, "/repo", "task-1", {
          refetchActive: true,
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
      host.agentSessionsListForTasks = originalBatchList;
      host.agentSessionsList = originalSingleList;
      queryClient.clear();
    }
  });
});
