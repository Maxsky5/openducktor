import type { WorkspaceRef } from "@openducktor/contracts";
import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import type { ClientConnection } from "../../connection/client-connection";
import { agentSessionQueryKeys } from "../../queries/agent-sessions";
import { taskWorktreeQueryKeys } from "../../queries/build-runtime";
import {
  createActiveWorkspaceWrapper,
  TEST_ACTIVE_WORKSPACE,
} from "../../test-support/active-workspace-wrapper";
import { createHookHarness } from "../../test-support/react-hook-harness";
import { createDeferred } from "../../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { useTaskCleanupImpact } from "./use-task-cleanup-impact";

const createSessionFixture = (): AgentSessionRecord => ({
  externalSessionId: "session-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/worktrees/task-1",
  startedAt: "2026-07-27T12:00:00.000Z",
  selectedModel: null,
});

const createHost = () => {
  const sessionFixture = createSessionFixture();
  const agentSessionsList = mock(async () => [sessionFixture]);
  const agentSessionsListForTasks = mock(async (_repoPath: WorkspaceRef, taskIds: string[]) =>
    taskIds.map((taskId) => ({
      taskId,
      agentSessions: taskId === "task-1" ? [sessionFixture] : [],
    })),
  );
  const taskWorktreeGet = mock(async (_repoPath: WorkspaceRef, taskId: string) => ({
    workingDirectory: `/worktrees/${taskId}`,
  }));
  const terminalList = mock(async () => ({ hostInstanceId: "host-1", revision: 1, terminals: [] }));

  return {
    calls: {
      agentSessionsList,
      agentSessionsListForTasks,
      taskWorktreeGet,
      terminalList,
    },
    connection: createTestClientConnection({
      client: { agentSessionsList, agentSessionsListForTasks, taskWorktreeGet, terminalList },
    }),
    sessionFixture,
  };
};

type HarnessProps = {
  enabled: boolean;
  taskIds: string[];
};

const createHarness = (initialProps: HarnessProps, connection: ClientConnection) =>
  createHookHarness(
    (props: HarnessProps) => {
      const queryClient = useQueryClient();
      const impact = useTaskCleanupImpact(props.taskIds, props.enabled);
      return { impact, queryClient };
    },
    initialProps,
    { wrapper: createActiveWorkspaceWrapper(connection) },
  );

describe("useTaskCleanupImpact", () => {
  test("issues no cleanup commands while disabled", async () => {
    const { calls, connection } = createHost();
    const harness = createHarness({ enabled: false, taskIds: ["task-1"] }, connection);

    try {
      await harness.mount();
      expect(harness.getLatest().impact).toMatchObject({
        impactError: null,
        isLoadingImpact: false,
        managedWorktreeCount: 0,
        terminalCount: 0,
      });
      expect(calls.agentSessionsListForTasks).not.toHaveBeenCalled();
      expect(calls.agentSessionsList).not.toHaveBeenCalled();
      expect(calls.taskWorktreeGet).not.toHaveBeenCalled();
      expect(calls.terminalList).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test.each([true, false])(
    "loads cold cleanup data once when the browser online hint is %s",
    async (online) => {
      const previous = onlineManager.isOnline();
      onlineManager.setOnline(online);
      const { calls, connection } = createHost();
      const harness = createHarness({ enabled: true, taskIds: ["task-2", "task-1"] }, connection);

      try {
        await harness.mount();
        await harness.waitFor(({ impact }) => !impact.isLoadingImpact, 500);
        expect(calls.agentSessionsListForTasks).toHaveBeenCalledTimes(1);
        expect(calls.agentSessionsListForTasks).toHaveBeenCalledWith(
          {
            workspaceId: TEST_ACTIVE_WORKSPACE.workspaceId,
            repoPath: TEST_ACTIVE_WORKSPACE.repoPath,
          },
          ["task-1", "task-2"],
        );
        expect(calls.agentSessionsList).not.toHaveBeenCalled();
        expect(calls.taskWorktreeGet).toHaveBeenCalledTimes(2);
        expect(calls.terminalList).toHaveBeenCalledTimes(2);
      } finally {
        try {
          await harness.unmount();
          await connection.dispose();
        } finally {
          onlineManager.setOnline(previous);
        }
      }
    },
  );

  test("reuses warm session and worktree cache entries", async () => {
    const { calls, connection, sessionFixture } = createHost();
    const initialProps = { enabled: false, taskIds: ["task-1"] };
    const harness = createHarness(initialProps, connection);

    try {
      await harness.mount();
      const { queryClient } = harness.getLatest();
      queryClient.setQueryData(agentSessionQueryKeys.list(TEST_ACTIVE_WORKSPACE, "task-1"), [
        sessionFixture,
      ]);
      queryClient.setQueryData(
        taskWorktreeQueryKeys.taskWorktree({
          workspaceId: TEST_ACTIVE_WORKSPACE.workspaceId,
          repoPath: "/repo",
          taskId: "task-1",
        }),
        { workingDirectory: "/worktrees/task-1" },
      );

      await harness.update({ ...initialProps, enabled: true });
      await harness.waitFor(({ impact }) => !impact.isLoadingImpact);
      expect(calls.agentSessionsListForTasks).not.toHaveBeenCalled();
      expect(calls.agentSessionsList).not.toHaveBeenCalled();
      expect(calls.taskWorktreeGet).not.toHaveBeenCalled();
      expect(calls.terminalList).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("refreshes an invalidated session entry through its canonical per-task query", async () => {
    const { calls, connection, sessionFixture } = createHost();
    const refresh = createDeferred<AgentSessionRecord[]>();
    calls.agentSessionsListForTasks.mockImplementation(async (_repo, ids) =>
      Promise.all(ids.map(async (taskId) => ({ taskId, agentSessions: await refresh.promise }))),
    );
    const initialProps = { enabled: false, taskIds: ["task-1"] };
    const harness = createHarness(initialProps, connection);

    try {
      await harness.mount();
      const { queryClient } = harness.getLatest();
      queryClient.setQueryData(agentSessionQueryKeys.list(TEST_ACTIVE_WORKSPACE, "task-1"), [
        sessionFixture,
      ]);
      await queryClient.invalidateQueries({
        queryKey: agentSessionQueryKeys.list(TEST_ACTIVE_WORKSPACE, "task-1"),
        exact: true,
        refetchType: "none",
      });

      await harness.update({ ...initialProps, enabled: true });
      await harness.waitFor(() => calls.agentSessionsListForTasks.mock.calls.length === 1);
      expect(harness.getLatest().impact.isLoadingImpact).toBe(true);
      await harness.run(() => refresh.resolve([sessionFixture]));
      await harness.waitFor(({ impact }) => !impact.isLoadingImpact);
      expect(calls.agentSessionsList).not.toHaveBeenCalled();
      expect(calls.agentSessionsListForTasks).toHaveBeenCalledTimes(1);
      expect(calls.agentSessionsListForTasks).toHaveBeenCalledWith(
        {
          workspaceId: TEST_ACTIVE_WORKSPACE.workspaceId,
          repoPath: TEST_ACTIVE_WORKSPACE.repoPath,
        },
        ["task-1"],
      );
    } finally {
      await harness.unmount();
    }
  });

  test.each([true, false])(
    "shows a cleanup read failure when the browser online hint is %s",
    async (online) => {
      const previous = onlineManager.isOnline();
      onlineManager.setOnline(online);
      const { calls, connection } = createHost();
      calls.agentSessionsListForTasks.mockImplementation(async () => {
        throw new Error("batch session read failed");
      });
      const harness = createHarness({ enabled: true, taskIds: ["task-1"] }, connection);

      try {
        await harness.mount();
        await harness.waitFor(({ impact }) => impact.impactError !== null, 500);
        expect(harness.getLatest().impact).toMatchObject({
          impactError: "Unable to load linked worktree cleanup impact.",
          isLoadingImpact: false,
        });
        expect(calls.agentSessionsListForTasks).toHaveBeenCalledTimes(1);
        expect(calls.agentSessionsList).not.toHaveBeenCalled();
      } finally {
        try {
          await harness.unmount();
          await connection.dispose();
        } finally {
          onlineManager.setOnline(previous);
        }
      }
    },
  );
});
