import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord, TaskPullRequestDetectResult } from "@openducktor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { createQueryClient } from "@/lib/query-client";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import {
  createDeferred,
  createSettingsSnapshotFixture,
  createTaskCardFixture,
  createWorkspaceRecordFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentSessionReadPort } from "../../queries/agent-sessions";
import { workspaceQueryKeys } from "../../queries/workspace";
import { host } from "../shared/host";
import { prepareTaskChatDraftCleanupTargets } from "./task-chat-draft-cleanup";
import { useTaskOperations } from "./use-task-operations";
import { useTaskResetOperations } from "./use-task-reset-operations";

describe("useTaskOperations", () => {
  test("keeps pull request progress when workspace selection clears task reads", async () => {
    const detection = createDeferred<TaskPullRequestDetectResult>();
    const originalDetect = host.taskPullRequestDetect;
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      workspaceQueryKeys.settingsSnapshot(),
      createSettingsSnapshotFixture(),
    );
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const workspace = createWorkspaceRecordFixture();
    const harness = createHookHarness(
      ({ activeWorkspace }) => useTaskOperations({ activeWorkspace }),
      { activeWorkspace: workspace },
      { wrapper },
    );
    host.taskPullRequestDetect = mock(() => detection.promise);

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
      host.taskPullRequestDetect = originalDetect;
      queryClient.clear();
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

  test("runs reset commands through dependency-local ports and refreshes task state", async () => {
    const taskReset = mock(async () => createTaskCardFixture({ id: "task-2", status: "open" }));
    const taskResetImplementation = mock(async () =>
      createTaskCardFixture({ id: "task-1", status: "ready_for_dev" }),
    );
    const success = mock(() => "success-toast");
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
          hostPort: { taskReset, taskResetImplementation },
          notificationPort: { error: mock(() => "error-toast"), success },
        }),
      undefined,
      { wrapper: IsolatedQueryWrapper },
    );

    try {
      await harness.mount();
      await harness.run((operations) => operations.resetTaskImplementation("task-1"));
      await harness.run((operations) => operations.resetTask("task-2"));

      expect(taskResetImplementation).toHaveBeenCalledWith("/repo", "task-1");
      expect(taskReset).toHaveBeenCalledWith("/repo", "task-2");
      expect(refreshTaskData).toHaveBeenCalledWith("/repo", "task-1");
      expect(refreshTaskData).toHaveBeenCalledWith("/repo", "task-2");
      expect(success).toHaveBeenCalledWith("Implementation reset", { description: "task-1" });
      expect(success).toHaveBeenCalledWith("Task reset", { description: "task-2" });
    } finally {
      await harness.unmount();
    }
  });

  test("reports and rethrows reset command failures through the notification port", async () => {
    const resetFailure = new Error("reset failed");
    const error = mock(() => "error-toast");
    const refreshTaskData = mock(async () => undefined);
    const harness = createHookHarness(
      () =>
        useTaskResetOperations({
          activeRepoPath: "/repo",
          agentSessionReadPort: { agentSessionsListForTasks: mock(async () => []) },
          refreshTaskData,
          hostPort: {
            taskReset: mock(async () => {
              throw resetFailure;
            }),
            taskResetImplementation: mock(async () => {
              throw resetFailure;
            }),
          },
          notificationPort: { error, success: mock(() => "success-toast") },
        }),
      undefined,
      { wrapper: IsolatedQueryWrapper },
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
      expect(error).toHaveBeenCalledWith("Failed to reset implementation", {
        description: "reset failed",
      });
      expect(error).toHaveBeenCalledWith("Failed to reset task", { description: "reset failed" });
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
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

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
