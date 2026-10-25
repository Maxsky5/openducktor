import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord, TaskPullRequestDetectResult } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import { IsolatedQueryWrapper } from "../../test-support/isolated-query-wrapper";
import { createHookHarness } from "../../test-support/react-hook-harness";
import { createFeedbackFake } from "../../test-support/feedback-fake";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import {
  createDeferred,
  createSettingsSnapshotFixture,
  createTaskCardFixture,
  createWorkspaceRecordFixture,
} from "../../test-support/shared-test-fixtures";
import type { AgentSessionReadPort } from "../../queries/agent-sessions";
import { workspaceQueryKeys } from "../../queries/workspace";
import { prepareTaskChatDraftCleanupTargets } from "./task-chat-draft-cleanup";
import { useTaskOperations } from "./use-task-operations";
import { useTaskResetOperations } from "./use-task-reset-operations";

describe("useTaskOperations", () => {
  test("keeps pull request progress when workspace selection clears task reads", async () => {
    const detection = createDeferred<TaskPullRequestDetectResult>();
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
        harness.run((operations) => operations.resetTaskImplementation("task-1")),
      ).rejects.toThrow("Select a workspace first.");
      await expect(harness.run((operations) => operations.resetTask("task-1"))).rejects.toThrow(
        "Select a workspace first.",
      );

      expect(agentSessionsListForTasks).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("runs reset commands on the host and refreshes task state", async () => {
    const taskReset = mock(async () => createTaskCardFixture({ id: "task-2", status: "open" }));
    const taskResetImplementation = mock(async () =>
      createTaskCardFixture({ id: "task-1", status: "ready_for_dev" }),
    );
    const feedback = createFeedbackFake();
    const connection = createTestClientConnection({
      client: { taskReset, taskResetImplementation },
      feedback,
    });
    const refreshTaskData = mock(async () => undefined);
    const agentSessionReadPort: AgentSessionReadPort = {
      agentSessionsListForTasks: mock(async (_repo: string, ids: string[]) =>
        ids.map((taskId) => ({ taskId, agentSessions: [] })),
      ),
    };
    const harness = createHookHarness(
      () =>
        useTaskResetOperations({
          activeRepoPath: "/repo",
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
      await harness.run((operations) => operations.resetTaskImplementation("task-1"));
      await harness.run((operations) => operations.resetTask("task-2"));

      expect(taskResetImplementation).toHaveBeenCalledWith("/repo", "task-1");
      expect(taskReset).toHaveBeenCalledWith("/repo", "task-2");
      expect(refreshTaskData).toHaveBeenCalledWith("/repo", "task-1");
      expect(refreshTaskData).toHaveBeenCalledWith("/repo", "task-2");
      expect(feedback.shownOf("success")).toEqual([
        { kind: "success", message: "Implementation reset", options: { description: "task-1" } },
        { kind: "success", message: "Task reset", options: { description: "task-2" } },
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("reports and rethrows reset command failures through client feedback", async () => {
    const resetFailure = new Error("reset failed");
    const feedback = createFeedbackFake();
    const connection = createTestClientConnection({
      client: {
        taskReset: mock(async () => {
          throw resetFailure;
        }),
        taskResetImplementation: mock(async () => {
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
        harness.run((operations) => operations.resetTaskImplementation("task-1")),
      ).rejects.toBe(resetFailure);
      await expect(harness.run((operations) => operations.resetTask("task-2"))).rejects.toBe(
        resetFailure,
      );

      expect(refreshTaskData).not.toHaveBeenCalled();
      expect(feedback.shownOf("error")).toEqual([
        {
          kind: "error",
          message: "Failed to reset implementation",
          options: { description: "reset failed" },
        },
        {
          kind: "error",
          message: "Failed to reset task",
          options: { description: "reset failed" },
        },
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("builds task mutation cleanup targets from the injected session read port", async () => {
    const session: AgentSessionRecord = {
      runtimeKind: "opencode",
      externalSessionId: "session-1",
      role: "build",
      startedAt: "2026-07-23T10:00:00.000Z",
      workingDirectory: "/repo/worktree",
      selectedModel: null,
    };
    const agentSessionReadPort: AgentSessionReadPort = {
      agentSessionsListForTasks: mock(async () => [{ taskId: "task-1", agentSessions: [session] }]),
    };
    const { queryClient } = createTestClientConnection({
      queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    });

    const plan = await prepareTaskChatDraftCleanupTargets({
      queryClient,
      repoPath: "/repo",
      workspaceId: "workspace-1",
      taskIds: ["task-1"],
      agentSessionReadPort,
    });

    expect(agentSessionReadPort.agentSessionsListForTasks).toHaveBeenCalledWith("/repo", [
      "task-1",
    ]);
    expect(plan.targets).toEqual([
      {
        workspaceId: "workspace-1",
        externalSessionId: "session-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        taskId: "task-1",
      },
    ]);
  });
});
