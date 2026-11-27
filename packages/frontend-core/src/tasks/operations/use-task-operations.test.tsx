import type { BackgroundOperationInvocation } from "@openducktor/host-client";
import { HostChannelRequestError, hostChannelInvokeError } from "@openducktor/host-client/channel";
import { QueryObserver } from "@tanstack/react-query";
import { taskWorktreeQueryKeys } from "../../queries/build-runtime";
import { taskWorktreeCleanupImpactQueryKeys } from "../../queries/task-worktree-cleanup-impact";
import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import type {
  BackgroundOperationSnapshot,
  TaskCard,
  TaskPullRequestDetectResult,
} from "@openducktor/contracts";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import { IsolatedQueryWrapper } from "../../test-support/isolated-query-wrapper";
import { createHookHarness } from "../../test-support/react-hook-harness";
import { createFeedbackFake } from "../../test-support/feedback-fake";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "../../test-support/test-client-connection";
import {
  createSettingsSnapshotFixture,
  createTaskCardFixture,
  createWorkspaceRecordFixture,
} from "../../test-support/shared-test-fixtures";
import type { AgentSessionReadPort } from "../../queries/agent-sessions";
import { workspaceQueryKeys } from "../../queries/workspace";
import { useTaskOperations } from "./use-task-operations";
import { useTaskResetOperations } from "./use-task-reset-operations";

describe("useTaskOperations", () => {
  test("keeps pull request progress when workspace selection clears task reads", async () => {
    const detection = Promise.withResolvers<TaskPullRequestDetectResult>();
    const connection = createTestClientConnection({
      client: { taskPullRequestDetect: mock(() => detection.promise) },
    });
    connection.queryClient.setQueryData(
      workspaceQueryKeys.settingsSnapshot(),
      createSettingsSnapshotFixture(),
    );
    const workspace = createWorkspaceRecordFixture();
    const harness = createHookHarness(
      ({ activeWorkspace }) => useTaskOperations({ activeWorkspace }),
      { activeWorkspace: workspace },
      {
        wrapper: ({ children }) => (
          <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
        ),
      },
    );

    try {
      await harness.mount();
      let detectionPromise: Promise<void> | undefined;
      await harness.run((operations) => {
        detectionPromise = operations.syncPullRequests("task-1");
      });
      await harness.run((operations) => operations.clearTaskData());
      await harness.update({
        activeWorkspace: createWorkspaceRecordFixture({
          workspaceId: "workspace-2",
          repoPath: "/other-repo",
        }),
      });
      await harness.run((operations) => operations.clearTaskData());
      await harness.update({ activeWorkspace: workspace });
      expect(harness.getLatest().detectingPullRequestTaskIds).toEqual(new Set(["task-1"]));
      await harness.run(async () => {
        detection.resolve({
          outcome: "not_found",
          sourceBranch: "feature/task-1",
          targetBranch: "main",
        });
        await detectionPromise;
      });
      expect(harness.getLatest().detectingPullRequestTaskIds).toEqual(new Set());
    } finally {
      await harness.unmount();
      connection.queryClient.clear();
    }
  });

  test("composes reset commands with workspace guards before reading session metadata", async () => {
    const agentSessionsListForTasks = mock(async () => []);
    const agentSessionReadPort: AgentSessionReadPort = {
      agentSessionsListForTasks,
    };
    const harness = createHookHarness(
      () => useTaskOperations({ activeWorkspace: null, agentSessionReadPort }),
      undefined,
      { wrapper: IsolatedQueryWrapper },
    );

    try {
      await harness.mount();

      await expect(
        harness.run(async (operations) => {
          await operations.resetTaskImplementation("task-1", "reset-implementation");
        }),
      ).rejects.toThrow("Select a workspace first.");
      await expect(
        harness.run(async (operations) => {
          await operations.resetTask("task-1");
        }),
      ).rejects.toThrow("Select a workspace first.");

      expect(agentSessionsListForTasks).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("runs reset commands on the host and refreshes task state", async () => {
    const taskReset = mock(async () => createTaskCardFixture({ id: "task-2", status: "open" }));
    const taskApplyEvent = mock(async () =>
      createTaskCardFixture({ id: "task-1", status: "ready_for_dev" }),
    );
    const feedback = createFeedbackFake();
    const connection = createTestClientConnection({
      client: { taskReset, taskApplyEvent },
      feedback,
    });
    const refreshTaskData = mock(async () => undefined);
    const agentSessionReadPort: AgentSessionReadPort = {
      agentSessionsListForTasks: mock(
        async (_scope: { workspaceId: string; repoPath: string }, ids: string[]) =>
          ids.map((taskId) => ({ taskId, agentSessions: [] })),
      ),
    };
    const harness = createHookHarness(
      () =>
        useTaskResetOperations({
          activeRepoPath: "/repo",
          activeWorkspaceId: "workspace-1",
          agentSessionReadPort,
          refreshTaskData,
        }),
      undefined,
      {
        wrapper: ({ children }) => (
          <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
        ),
      },
    );

    try {
      await harness.mount();
      await harness.run(async (operations) => {
        await operations.resetTaskImplementation("task-1", "reset-implementation");
      });
      await harness.run(async (operations) => {
        await operations.resetTask("task-2");
      });

      expect(taskApplyEvent).toHaveBeenCalledWith(
        { workspaceId: "workspace-1", repoPath: "/repo" },
        "task-1",
        "reset-implementation",
        { operationId: expect.any(String) },
      );
      expect(taskReset).toHaveBeenCalledWith(
        { workspaceId: "workspace-1", repoPath: "/repo" },
        "task-2",
        { operationId: expect.any(String) },
      );
      expect(refreshTaskData).toHaveBeenCalledWith(
        { workspaceId: "workspace-1", repoPath: "/repo" },
        "task-1",
      );
      expect(refreshTaskData).toHaveBeenCalledWith(
        { workspaceId: "workspace-1", repoPath: "/repo" },
        "task-2",
      );
      expect(feedback.shownOf("success")).toEqual([]);
      expect(connection.backgroundOperations.getSnapshot()).toMatchObject([
        { action: "Reset implementation", phase: "succeeded" },
        { action: "Reset task", phase: "succeeded" },
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("records an unconfirmed reset result without repeating the command", async () => {
    const resetFailure = new Error("reset failed");
    const feedback = createFeedbackFake();
    const connection = createTestClientConnection({
      client: {
        taskReset: mock(async () => {
          throw resetFailure;
        }),
        taskApplyEvent: mock(async () => {
          throw resetFailure;
        }),
      },
      feedback,
    });
    const refreshTaskData = mock(async () => undefined);
    const harness = createHookHarness(
      () =>
        useTaskResetOperations({
          activeRepoPath: "/repo",
          activeWorkspaceId: "workspace-1",
          agentSessionReadPort: { agentSessionsListForTasks: mock(async () => []) },
          refreshTaskData,
        }),
      undefined,
      {
        wrapper: ({ children }) => (
          <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
        ),
      },
    );

    try {
      await harness.mount();
      await expect(
        harness.run(async (operations) => {
          await operations.resetTaskImplementation("task-1", "reset-implementation");
        }),
      ).rejects.toBe(resetFailure);
      await expect(
        harness.run(async (operations) => {
          await operations.resetTask("task-2");
        }),
      ).rejects.toBe(resetFailure);

      expect(refreshTaskData).not.toHaveBeenCalled();
      expect(feedback.shownOf("error")).toEqual([]);
      expect(connection.backgroundOperations.getSnapshot()).toMatchObject([
        { action: "Reset implementation", phase: "unconfirmed" },
        { action: "Reset task", phase: "unconfirmed" },
      ]);
    } finally {
      await harness.unmount();
    }
  });
});

test.each([
  ["removeTaskWorktree", "succeeded", "lost reply"],
  ["removeTaskWorktree", "failed", "lost reply"],
  ["closeTask", "failed", "confirmed reply"],
  ["deleteTask", "failed", "confirmed reply"],
  ["linkMergedPullRequest", "failed", "confirmed reply"],
  ["resetTask", "succeeded", "lost reply"],
  ["resetTaskImplementation", "succeeded", "lost reply"],
  ["resetTask", "succeeded", "reply after event"],
] as const)(
  "%s refreshes the original worktree once on confirmed %s with %s",
  async (action, phase, replyOrder) => {
    const reply = Promise.withResolvers<TaskCard>();
    const started = Promise.withResolvers<string>();
    type Listener = Parameters<
      ReturnType<typeof createTestHostConnection>["subscribeBackgroundOperationProgress"]
    >[0];
    let receive: Listener | undefined;
    const invoke = mock((tracking?: BackgroundOperationInvocation) => {
      if (!tracking) throw new Error("Expected operation tracking");
      started.resolve(tracking.operationId);
      return reply.promise;
    });
    const host = createTestHostConnection({
      client: {
        agentSessionsListForTasks: async () => [],
        taskClose: (_workspace, _taskId, _removeWorktree, tracking) => invoke(tracking),
        taskReset: (_workspace, _taskId, tracking) => invoke(tracking),
        taskApplyEvent: (_workspace, _taskId, _eventId, tracking) => invoke(tracking),
        taskDelete: async (_workspace, _taskId, tracking) => {
          await invoke(tracking);
          return { ok: true };
        },
        taskPullRequestDetect: async () => ({
          outcome: "merged",
          pullRequest: {
            providerId: "github",
            number: 17,
            url: "https://github.com/openai/openducktor/pull/17",
            state: "merged",
            createdAt: "2026-07-10T08:00:00.000Z",
            updatedAt: "2026-07-10T08:00:00.000Z",
          },
        }),
        taskPullRequestLinkMerged: (_workspace, _taskId, _pullRequest, _removeWorktree, tracking) =>
          invoke(tracking),
        taskWorktreeRemove: async (_workspace, _taskId, tracking) => {
          await invoke(tracking);
        },
      },
      subscribeBackgroundOperationProgress: async (listener) => {
        receive = listener;
        return () => {};
      },
    });
    const connection = createTestClientConnection({ host });
    const { queryClient } = connection;
    const workspace = createWorkspaceRecordFixture({
      workspaceId: "workspace-1",
      repoPath: "/repo",
    });
    const other = createWorkspaceRecordFixture({ workspaceId: "workspace-2", repoPath: "/other" });
    const taskId = "task-1";
    const originalKey = taskWorktreeQueryKeys.taskWorktree({
      ...workspace,
      taskId,
      taskVersion: "1",
    });
    const impactKey = taskWorktreeCleanupImpactQueryKeys.get(workspace, taskId);
    const otherKey = taskWorktreeQueryKeys.taskWorktree({ ...other, taskId });
    let present = true;
    const refreshed = Promise.withResolvers<void>();
    const read = mock(async () => (present ? "present" : "removed"));
    const stop = new QueryObserver(queryClient, {
      queryKey: originalKey,
      queryFn: read,
      staleTime: Infinity,
    }).subscribe((result) => {
      if (result.data === "removed") refreshed.resolve();
    });
    await queryClient.ensureQueryData({ queryKey: originalKey, queryFn: read });
    queryClient.setQueryData(impactKey, { present: true });
    queryClient.setQueryData(otherKey, "present");
    const harness = createHookHarness(
      ({ activeWorkspace }) => useTaskOperations({ activeWorkspace }),
      { activeWorkspace: workspace },
      {
        wrapper: ({ children }) => (
          <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
        ),
      },
    );
    try {
      await harness.mount();
      if (action === "linkMergedPullRequest") {
        await harness.run((operations) => operations.syncPullRequests(taskId));
      }
      await harness.run(async (operations) => {
        const start = {
          removeTaskWorktree: () => operations.removeTaskWorktree(taskId),
          closeTask: () => operations.closeTask(taskId, { removeWorktree: true }),
          deleteTask: () => operations.deleteTask(taskId),
          linkMergedPullRequest: () => operations.linkMergedPullRequest({ removeWorktree: true }),
          resetTask: () => operations.resetTask(taskId),
          resetTaskImplementation: () => operations.resetTaskImplementation(taskId, "reset"),
        };
        const result = start[action]().catch((cause) => cause);
        const operationId = await started.promise;
        const snapshot = {
          operationId,
          hostInstanceId: "host",
          workspace: { workspaceId: workspace.workspaceId, repoPath: workspace.repoPath },
          target: { kind: "task", taskId },
          revision: 4,
          steps: [
            {
              id: "worktrees",
              label: "Remove worktrees",
              state: "completed",
              details: [],
              resources: [{ kind: "worktree", value: "/worktrees/task-1", state: "removed" }],
            },
          ],
          ...(phase === "failed"
            ? {
                phase,
                failure: {
                  stage: "branches",
                  code: "cleanup_failed",
                  message: "Branch deletion failed",
                  nextAction: "Check the branch",
                },
              }
            : { phase }),
        } satisfies BackgroundOperationSnapshot;
        await harness.update({ activeWorkspace: other });
        if (replyOrder === "confirmed reply" && snapshot.phase === "failed") {
          present = false;
          const error = hostChannelInvokeError(
            new HostChannelRequestError({
              kind: "host",
              response: { message: snapshot.failure.message, operationProgress: snapshot },
            }),
          );
          reply.reject(error);
          expect(await result).toBe(action === "linkMergedPullRequest" ? undefined : error);
          expect(read).toHaveBeenCalledTimes(2);
          await refreshed.promise;
        } else if (replyOrder === "lost reply") {
          const error = new Error("The reply was lost");
          reply.reject(error);
          expect(await result).toBe(error);
          expect(read).toHaveBeenCalledTimes(1);
          expect(queryClient.getQueryData(originalKey)).toBe("present");
        }
        present = false;
        receive?.({
          channel: "openducktor://background-operation-progress",
          payload: { ...snapshot, revision: snapshot.revision + 1 },
        });
        expect(read).toHaveBeenCalledTimes(2);
        await refreshed.promise;
        if (replyOrder === "reply after event") {
          reply.resolve(createTaskCardFixture({ id: taskId }));
          expect(await result).toMatchObject({ id: taskId });
          expect(read).toHaveBeenCalledTimes(2);
        }
        expect(queryClient.getQueryData(otherKey)).toBe("present");
        expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);
        expect(queryClient.getQueryState(impactKey)?.isInvalidated).toBe(true);
        expect(invoke).toHaveBeenCalledTimes(1);
      });
    } finally {
      stop();
      await harness.unmount();
      connection.backgroundOperations.dispose();
      queryClient.clear();
    }
  },
);
