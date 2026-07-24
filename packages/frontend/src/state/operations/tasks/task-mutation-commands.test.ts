import { describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import type { TaskChatDraftCleanup } from "./task-chat-draft-cleanup";
import type { TaskMutationRunner } from "./task-mutation-runner";
import {
  createTaskMutationCommands,
  type TaskMutationCommandCacheImpact,
  type TaskMutationCommandHostPort,
} from "./use-task-mutation-commands";

const createQueryClient = (): QueryClient =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const createHostPort = (): TaskMutationCommandHostPort => ({
  taskCreate: async () => undefined,
  taskUpdate: async () => undefined,
  taskDelete: async () => undefined,
  taskClose: async () => undefined,
  taskTransition: async () => undefined,
  humanApprove: async () => undefined,
  humanRequestChanges: async () => undefined,
});

const createRunTaskMutation =
  (
    received: Parameters<TaskMutationRunner["runTaskMutation"]>[0][],
  ): TaskMutationRunner["runTaskMutation"] =>
  async (options) => {
    received.push(options);
    await options.run("/repo");
  };

const createCacheImpact = (): TaskMutationCommandCacheImpact => ({
  removeDeletedTaskCaches: async () => undefined,
  invalidateTaskWorktree: async () => undefined,
});

describe("createTaskMutationCommands", () => {
  test("normalizes a nonblank title before creating the task", async () => {
    const received: Parameters<TaskMutationRunner["runTaskMutation"]>[0][] = [];
    const taskCreate = mock(async () => undefined);
    const commands = createTaskMutationCommands({
      activeRepoPath: "/repo",
      activeWorkspaceId: "workspace-1",
      tasks: [],
      runTaskMutation: createRunTaskMutation(received),
      hostPort: { ...createHostPort(), taskCreate },
      queryClient: createQueryClient(),
      cacheImpact: createCacheImpact(),
      taskChatDraftCleanup: { runMutation: (input) => input.mutation() },
    });

    await commands.createTask({
      title: "  Ship the release  ",
      issueType: "task",
      aiReviewEnabled: true,
      priority: 2,
    });

    expect(taskCreate).toHaveBeenCalledWith("/repo", {
      title: "Ship the release",
      issueType: "task",
      aiReviewEnabled: true,
      priority: 2,
    });
    expect(received).toHaveLength(1);
  });

  test("does nothing for a blank title", async () => {
    const received: Parameters<TaskMutationRunner["runTaskMutation"]>[0][] = [];
    const taskCreate = mock(async () => undefined);
    const commands = createTaskMutationCommands({
      activeRepoPath: "/repo",
      activeWorkspaceId: "workspace-1",
      tasks: [],
      runTaskMutation: createRunTaskMutation(received),
      hostPort: { ...createHostPort(), taskCreate },
      queryClient: createQueryClient(),
      cacheImpact: createCacheImpact(),
      taskChatDraftCleanup: { runMutation: (input) => input.mutation() },
    });

    await commands.createTask({
      title: " \n\t ",
      issueType: "task",
      aiReviewEnabled: true,
      priority: 2,
    });

    expect(taskCreate).not.toHaveBeenCalled();
    expect(received).toEqual([]);
  });

  test("rejects task creation without an active repository before calling the host", async () => {
    const received: Parameters<TaskMutationRunner["runTaskMutation"]>[0][] = [];
    const taskCreate = mock(async () => undefined);
    const commands = createTaskMutationCommands({
      activeRepoPath: null,
      activeWorkspaceId: "workspace-1",
      tasks: [],
      runTaskMutation: createRunTaskMutation(received),
      hostPort: { ...createHostPort(), taskCreate },
      queryClient: createQueryClient(),
      cacheImpact: createCacheImpact(),
      taskChatDraftCleanup: { runMutation: (input) => input.mutation() },
    });

    await expect(
      commands.createTask({
        title: "Create task",
        issueType: "task",
        aiReviewEnabled: true,
        priority: 2,
      }),
    ).rejects.toThrow("Select a workspace first.");

    expect(taskCreate).not.toHaveBeenCalled();
    expect(received).toEqual([]);
  });

  test("refreshes only the task list after a successful create", async () => {
    const received: Parameters<TaskMutationRunner["runTaskMutation"]>[0][] = [];
    const refreshImpacts: string[] = [];
    const taskCreate = mock(async () => undefined);
    const runTaskMutation: TaskMutationRunner["runTaskMutation"] = async (options) => {
      received.push(options);
      await options.run("/current-repo");
      if (options.refreshStrategy.kind === "repo") {
        refreshImpacts.push("task-list-only");
      }
    };
    const commands = createTaskMutationCommands({
      activeRepoPath: "/current-repo",
      activeWorkspaceId: "workspace-1",
      tasks: [],
      runTaskMutation,
      hostPort: { ...createHostPort(), taskCreate },
      queryClient: createQueryClient(),
      cacheImpact: createCacheImpact(),
      taskChatDraftCleanup: { runMutation: (input) => input.mutation() },
    });

    await commands.createTask({
      title: "Create task",
      issueType: "task",
      aiReviewEnabled: true,
      priority: 2,
    });

    expect(received[0]?.refreshStrategy).toEqual({ kind: "repo" });
    expect(refreshImpacts).toEqual(["task-list-only"]);
    expect(taskCreate).toHaveBeenCalledWith("/current-repo", {
      title: "Create task",
      issueType: "task",
      aiReviewEnabled: true,
      priority: 2,
    });
  });

  test("does not report success or refresh after a create host failure", async () => {
    const received: Parameters<TaskMutationRunner["runTaskMutation"]>[0][] = [];
    const outcomes: string[] = [];
    const refreshImpacts: string[] = [];
    const taskCreate = mock(async () => {
      throw new Error("Create failed");
    });
    const runTaskMutation: TaskMutationRunner["runTaskMutation"] = async (options) => {
      received.push(options);
      try {
        await options.run("/repo");
        refreshImpacts.push(options.refreshStrategy.kind);
        if (options.successTitle) {
          outcomes.push(`success:${options.successTitle}`);
        }
      } catch (error) {
        outcomes.push(`failure:${options.failureTitle}`);
        throw error;
      }
    };
    const commands = createTaskMutationCommands({
      activeRepoPath: "/repo",
      activeWorkspaceId: "workspace-1",
      tasks: [],
      runTaskMutation,
      hostPort: { ...createHostPort(), taskCreate },
      queryClient: createQueryClient(),
      cacheImpact: createCacheImpact(),
      taskChatDraftCleanup: { runMutation: (input) => input.mutation() },
    });

    await expect(
      commands.createTask({
        title: "Create task",
        issueType: "task",
        aiReviewEnabled: true,
        priority: 2,
      }),
    ).rejects.toThrow("Create failed");

    expect(taskCreate).toHaveBeenCalledWith("/repo", {
      title: "Create task",
      issueType: "task",
      aiReviewEnabled: true,
      priority: 2,
    });
    expect(outcomes).toEqual(["failure:Failed to create task"]);
    expect(refreshImpacts).toEqual([]);
  });

  test("deletes the full task subtree and requests cached document removal for every deleted id", async () => {
    const received: Parameters<TaskMutationRunner["runTaskMutation"]>[0][] = [];
    const taskDelete = mock(async () => undefined);
    const removeDeletedTaskCaches = mock(async () => undefined);
    const invalidatedWorktrees: [string, string][] = [];
    const invalidateTaskWorktree = mock(async (repoPath: string, taskId: string) => {
      invalidatedWorktrees.push([repoPath, taskId]);
    });
    const cleanupTaskIds: string[][] = [];
    const taskChatDraftCleanup: Pick<TaskChatDraftCleanup, "runMutation"> = {
      runMutation: async (input) => {
        cleanupTaskIds.push(input.taskIds);
        return input.mutation();
      },
    };
    const tasks: TaskCard[] = [
      createTaskCardFixture({ id: "parent", subtaskIds: ["child"] }),
      createTaskCardFixture({ id: "child", subtaskIds: ["grandchild"] }),
      createTaskCardFixture({ id: "grandchild" }),
    ];
    const commands = createTaskMutationCommands({
      activeRepoPath: "/repo",
      activeWorkspaceId: "workspace-1",
      tasks,
      runTaskMutation: createRunTaskMutation(received),
      hostPort: { ...createHostPort(), taskDelete },
      queryClient: createQueryClient(),
      cacheImpact: { removeDeletedTaskCaches, invalidateTaskWorktree },
      taskChatDraftCleanup,
    });

    await commands.deleteTask("parent", true);

    expect(taskDelete).toHaveBeenCalledWith("/repo", "parent", true);
    expect(cleanupTaskIds).toEqual([["parent", "child", "grandchild"]]);
    expect(received[0]?.refreshStrategy).toEqual({
      kind: "remove-task",
      taskIds: ["parent", "child", "grandchild"],
    });
    expect(removeDeletedTaskCaches).toHaveBeenCalledWith("/repo", [
      "parent",
      "child",
      "grandchild",
    ]);
    expect(invalidatedWorktrees).toEqual([
      ["/repo", "parent"],
      ["/repo", "child"],
      ["/repo", "grandchild"],
    ]);
  });

  test("routes close, closed transition, and approval through cleanup after their host mutations", async () => {
    const received: Parameters<TaskMutationRunner["runTaskMutation"]>[0][] = [];
    const calls: string[] = [];
    const hostPort: TaskMutationCommandHostPort = {
      ...createHostPort(),
      taskClose: async () => {
        calls.push("close");
      },
      taskTransition: async (_repoPath, _taskId, status, reason) => {
        calls.push(`transition:${status}:${reason}`);
      },
      humanApprove: async () => {
        calls.push("approve");
      },
    };
    const taskChatDraftCleanup: Pick<TaskChatDraftCleanup, "runMutation"> = {
      runMutation: async (input) => {
        calls.push(`cleanup:${input.taskIds[0]}:before`);
        const result = await input.mutation();
        calls.push(`cleanup:${input.taskIds[0]}:after`);
        return result;
      },
    };
    const commands = createTaskMutationCommands({
      activeRepoPath: "/repo",
      activeWorkspaceId: "workspace-1",
      tasks: [],
      runTaskMutation: createRunTaskMutation(received),
      hostPort,
      queryClient: createQueryClient(),
      cacheImpact: createCacheImpact(),
      taskChatDraftCleanup,
    });

    await commands.closeTask("task-1");
    await commands.transitionTask("task-2", "closed", "merged");
    await commands.humanApproveTask("task-3");

    expect(calls).toEqual([
      "cleanup:task-1:before",
      "close",
      "cleanup:task-1:after",
      "cleanup:task-2:before",
      "transition:closed:merged",
      "cleanup:task-2:after",
      "cleanup:task-3:before",
      "approve",
      "cleanup:task-3:after",
    ]);
    expect(received.map((options) => options.refreshStrategy)).toEqual([
      { kind: "task", taskId: "task-1" },
      { kind: "task", taskId: "task-2" },
      { kind: "task", taskId: "task-3" },
    ]);
  });
});
