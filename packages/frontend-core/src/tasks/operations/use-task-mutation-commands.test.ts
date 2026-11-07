import { workspaceRefFixture } from "../../test-support/workspace-ref-fixture";
import { describe, expect, mock, test } from "bun:test";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { QueryClient } from "@tanstack/react-query";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import { taskQueryKeys } from "../../queries/tasks";
import { issueItemsQueryKeys } from "../../queries/issue-items";
import { agentSessionQueryKeys } from "../../queries/agent-sessions";
import { taskWorktreeQueryKeys } from "../../queries/build-runtime";
import { taskStopImpactQueryKeys } from "../../queries/task-stop-impact";
import { taskWorktreeCleanupImpactQueryKeys } from "../../queries/task-worktree-cleanup-impact";
import type { TaskChatDraftCleanup } from "./task-chat-draft-cleanup";
import type { TaskMutationRunner } from "./task-mutation-runner";
import {
  createTaskMutationCommands,
  type TaskMutationCommandHostPort,
} from "./use-task-mutation-commands";
import type { ResolvedTaskCard as TaskCard } from "@openducktor/workflows";

const createQueryClient = (): QueryClient => createTestClientConnection().queryClient;

const createHostPort = (): TaskMutationCommandHostPort => ({
  taskCreate: async () => createTaskCardFixture(),
  taskUpdate: async () => createTaskCardFixture(),
  taskDelete: async () => ({ ok: true }),
  taskClose: async () => createTaskCardFixture(),
  taskWorktreeRemove: async () => undefined,
});

const createRunTaskMutation =
  (
    received: Parameters<TaskMutationRunner["runTaskMutation"]>[0][],
  ): TaskMutationRunner["runTaskMutation"] =>
  async (options) => {
    received.push(options);
    return options.run("/repo");
  };

describe("createTaskMutationCommands", () => {
  test("a delayed target-branch response does not overwrite a newer committed card", async () => {
    const client = createQueryClient();
    const previous = createTaskCardFixture({ id: "task-1", targetBranch: { branch: "main" } });
    const saved = { ...previous, targetBranch: { branch: "release" } };
    const latest = { ...saved, title: "Newer title", priority: 1 };
    let resolveUpdate!: (card: TaskCard) => void;
    const response = new Promise<TaskCard>((resolve) => {
      resolveUpdate = resolve;
    });
    client.setQueryData(taskQueryKeys.repoData({ workspaceId: "workspace-1", repoPath: "/repo" }), {
      tasks: [previous],
    });
    const commands = createTaskMutationCommands({
      activeRepoPath: "/repo",
      activeWorkspaceId: "workspace-1",
      queryClient: client,
      hostPort: { ...createHostPort(), taskUpdate: () => response },
      runTaskMutation: (options) => options.run("/repo"),
      taskChatDraftCleanup: { runMutation: (input) => input.mutation() },
    });
    try {
      const mutation = commands.setTaskTargetBranch("task-1", saved.targetBranch);
      client.setQueryData(
        taskQueryKeys.repoData({ workspaceId: "workspace-1", repoPath: "/repo" }),
        { tasks: [latest] },
      );
      resolveUpdate(saved);
      await mutation;
      expect(
        client.getQueryData<{ tasks: TaskCard[] }>(
          taskQueryKeys.repoData({ workspaceId: "workspace-1", repoPath: "/repo" }),
        ),
      ).toEqual({
        tasks: [latest],
      });
    } finally {
      client.clear();
    }
  });

  test("normalizes a nonblank title before creating the task", async () => {
    const received: Parameters<TaskMutationRunner["runTaskMutation"]>[0][] = [];
    const taskCreate = mock(async () => createTaskCardFixture());
    const commands = createTaskMutationCommands({
      activeRepoPath: "/repo",
      activeWorkspaceId: "workspace-1",
      runTaskMutation: createRunTaskMutation(received),
      hostPort: { ...createHostPort(), taskCreate },
      queryClient: createQueryClient(),
      taskChatDraftCleanup: { runMutation: (input) => input.mutation() },
    });

    await commands.createTask({
      title: "  Ship the release  ",
      issueType: "task",
      priority: 2,
    });

    expect(taskCreate).toHaveBeenCalledWith(
      { workspaceId: "workspace-1", repoPath: "/repo" },
      {
        title: "Ship the release",
        issueType: "task",
        priority: 2,
      },
      undefined,
    );
    expect(received).toHaveLength(1);
  });

  test("does nothing for a blank title", async () => {
    const received: Parameters<TaskMutationRunner["runTaskMutation"]>[0][] = [];
    const taskCreate = mock(async () => createTaskCardFixture());
    const commands = createTaskMutationCommands({
      activeRepoPath: "/repo",
      activeWorkspaceId: "workspace-1",
      runTaskMutation: createRunTaskMutation(received),
      hostPort: { ...createHostPort(), taskCreate },
      queryClient: createQueryClient(),
      taskChatDraftCleanup: { runMutation: (input) => input.mutation() },
    });

    await commands.createTask({
      title: " \n\t ",
      issueType: "task",
      priority: 2,
    });

    expect(taskCreate).not.toHaveBeenCalled();
    expect(received).toEqual([]);
  });

  test("rejects task creation without an active repository before calling the host", async () => {
    const received: Parameters<TaskMutationRunner["runTaskMutation"]>[0][] = [];
    const taskCreate = mock(async () => createTaskCardFixture());
    const commands = createTaskMutationCommands({
      activeRepoPath: null,
      activeWorkspaceId: "workspace-1",
      runTaskMutation: createRunTaskMutation(received),
      hostPort: { ...createHostPort(), taskCreate },
      queryClient: createQueryClient(),
      taskChatDraftCleanup: { runMutation: (input) => input.mutation() },
    });

    await expect(
      commands.createTask({
        title: "Create task",
        issueType: "task",
        priority: 2,
      }),
    ).rejects.toThrow("Select a workspace first.");

    expect(taskCreate).not.toHaveBeenCalled();
    expect(received).toEqual([]);
  });

  test("runs a task create once and reports its result", async () => {
    const received: Parameters<TaskMutationRunner["runTaskMutation"]>[0][] = [];
    const taskCreate = mock(async () => createTaskCardFixture());
    const runTaskMutation: TaskMutationRunner["runTaskMutation"] = async (options) => {
      received.push(options);
      return options.run("/current-repo");
    };
    const commands = createTaskMutationCommands({
      activeRepoPath: "/current-repo",
      activeWorkspaceId: "workspace-1",
      runTaskMutation,
      hostPort: { ...createHostPort(), taskCreate },
      queryClient: createQueryClient(),
      taskChatDraftCleanup: { runMutation: (input) => input.mutation() },
    });

    await commands.createTask({
      title: "Create task",
      issueType: "task",
      priority: 2,
    });

    expect(taskCreate).toHaveBeenCalledWith(
      { workspaceId: "workspace-1", repoPath: "/current-repo" },
      {
        title: "Create task",
        issueType: "task",
        priority: 2,
      },
      undefined,
    );
  });

  test("does not report success or refresh after a create host failure", async () => {
    const received: Parameters<TaskMutationRunner["runTaskMutation"]>[0][] = [];
    const outcomes: string[] = [];
    const taskCreate = mock(async () => {
      throw new Error("Create failed");
    });
    const runTaskMutation: TaskMutationRunner["runTaskMutation"] = async (options) => {
      received.push(options);
      try {
        const result = await options.run("/repo");
        if (options.successTitle) {
          outcomes.push(`success:${options.successTitle}`);
        }
        return result;
      } catch (error) {
        outcomes.push(`failure:${options.failureTitle}`);
        throw error;
      }
    };
    const commands = createTaskMutationCommands({
      activeRepoPath: "/repo",
      activeWorkspaceId: "workspace-1",
      runTaskMutation,
      hostPort: { ...createHostPort(), taskCreate },
      queryClient: createQueryClient(),
      taskChatDraftCleanup: { runMutation: (input) => input.mutation() },
    });

    await expect(
      commands.createTask({
        title: "Create task",
        issueType: "task",
        priority: 2,
      }),
    ).rejects.toThrow("Create failed");

    expect(taskCreate).toHaveBeenCalledWith(
      { workspaceId: "workspace-1", repoPath: "/repo" },
      {
        title: "Create task",
        issueType: "task",
        priority: 2,
      },
      undefined,
    );
    expect(outcomes).toEqual(["failure:Failed to create task"]);
  });

  test("forwards staged description assets through create and update", async () => {
    const received: Parameters<TaskMutationRunner["runTaskMutation"]>[0][] = [];
    const taskCreate = mock(async () => createTaskCardFixture());
    const taskUpdate = mock(async () => createTaskCardFixture());
    const commands = createTaskMutationCommands({
      activeRepoPath: "/repo",
      activeWorkspaceId: "workspace-1",
      runTaskMutation: createRunTaskMutation(received),
      hostPort: { ...createHostPort(), taskCreate, taskUpdate },
      queryClient: createQueryClient(),
      taskChatDraftCleanup: { runMutation: (input) => input.mutation() },
    });
    const assets = {
      stagedAssetIds: ["550e8400-e29b-41d4-a716-446655440000"],
    };

    await commands.createTask(
      {
        title: "Create task",
        issueType: "task",
        priority: 2,
      },
      assets,
    );
    await commands.updateTask("task-1", { description: "Updated" }, assets);

    expect(taskCreate).toHaveBeenCalledWith(
      { workspaceId: "workspace-1", repoPath: "/repo" },
      {
        title: "Create task",
        issueType: "task",
        priority: 2,
      },
      assets,
    );
    expect(taskUpdate).toHaveBeenCalledWith(
      { workspaceId: "workspace-1", repoPath: "/repo" },
      "task-1",
      { description: "Updated" },
      assets,
    );
  });

  test("deletes a task and removes its cached session list", async () => {
    const received: Parameters<TaskMutationRunner["runTaskMutation"]>[0][] = [];
    const taskDelete = mock(async () => ({ ok: true }));
    const queryClient = createQueryClient();
    const scope = { workspaceId: "workspace-1", repoPath: "/repo" };
    const sessionsKey = agentSessionQueryKeys.list(scope, "task-1");
    const stopImpactKey = taskStopImpactQueryKeys.repo(scope);
    const worktreeKey = taskWorktreeQueryKeys.taskWorktree({ ...scope, taskId: "task-1" });
    queryClient.setQueryData(sessionsKey, []);
    queryClient.setQueryData(stopImpactKey, {});
    queryClient.setQueryData(worktreeKey, {});
    const cleanupTaskIds: string[][] = [];
    const taskChatDraftCleanup: Pick<TaskChatDraftCleanup, "runMutation"> = {
      runMutation: async (input) => {
        cleanupTaskIds.push(input.taskIds);
        return input.mutation();
      },
    };
    const commands = createTaskMutationCommands({
      activeRepoPath: "/repo",
      activeWorkspaceId: "workspace-1",
      runTaskMutation: createRunTaskMutation(received),
      hostPort: { ...createHostPort(), taskDelete },
      queryClient,
      taskChatDraftCleanup,
    });

    await commands.deleteTask("task-1");

    expect(taskDelete).toHaveBeenCalledWith(
      { workspaceId: "workspace-1", repoPath: "/repo" },
      "task-1",
    );
    expect(cleanupTaskIds).toEqual([["task-1"]]);
    expect(queryClient.getQueryState(sessionsKey)).toBeUndefined();
    expect(queryClient.getQueryState(stopImpactKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(worktreeKey)?.isInvalidated).toBe(true);
  });

  test("invalidates cached issue links for the deleted task's repository", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryDefaults(
      issueItemsQueryKeys.repo({ workspaceId: "workspace-1", repoPath: "/repo" }),
      { staleTime: 60_000 },
    );
    const repoIssueKey = [
      ...issueItemsQueryKeys.repo({ workspaceId: "workspace-1", repoPath: "/repo" }),
      "azure_devops",
      "work-items",
    ];
    const otherRepoIssueKey = [
      ...issueItemsQueryKeys.repo(workspaceRefFixture("/other")),
      "azure_devops",
      "work-items",
    ];
    queryClient.setQueryData(repoIssueKey, { items: [{ linkedTaskId: "task-1" }] });
    queryClient.setQueryData(otherRepoIssueKey, { items: [{ linkedTaskId: "other-task" }] });
    const commands = createTaskMutationCommands({
      activeRepoPath: "/repo",
      activeWorkspaceId: "workspace-1",
      runTaskMutation: createRunTaskMutation([]),
      hostPort: createHostPort(),
      queryClient,
      taskChatDraftCleanup: { runMutation: (input) => input.mutation() },
    });

    await commands.deleteTask("task-1");

    expect(queryClient.getQueryState(repoIssueKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherRepoIssueKey)?.isInvalidated).toBe(false);
  });

  test("routes close through cleanup after its host mutation", async () => {
    const received: Parameters<TaskMutationRunner["runTaskMutation"]>[0][] = [];
    const calls: string[] = [];
    const hostPort: TaskMutationCommandHostPort = {
      ...createHostPort(),
      taskClose: async (_repoPath, _taskId, removeWorktree) => {
        calls.push(`close:${removeWorktree}`);
        return createTaskCardFixture();
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
      runTaskMutation: createRunTaskMutation(received),
      hostPort,
      queryClient: createQueryClient(),
      taskChatDraftCleanup,
    });

    await commands.closeTask("task-1", { removeWorktree: false });

    expect(calls).toEqual(["cleanup:task-1:before", "close:false", "cleanup:task-1:after"]);
    expect(received[0]?.successDescription).toBe(
      "task-1. Its worktree and local branch were kept.",
    );
  });

  test("removes the worktree of a closed task and reads its cleanup impact again", async () => {
    const calls: string[] = [];
    const queryClient = createQueryClient();
    const impactKey = taskWorktreeCleanupImpactQueryKeys.get(
      { workspaceId: "workspace-1", repoPath: "/repo" },
      "task-1",
    );
    queryClient.setQueryData(impactKey, {});
    const commands = createTaskMutationCommands({
      activeRepoPath: "/repo",
      activeWorkspaceId: "workspace-1",
      runTaskMutation: createRunTaskMutation([]),
      hostPort: {
        ...createHostPort(),
        taskWorktreeRemove: async (repoPath, taskId) => {
          calls.push(`remove:${repoPath.repoPath}:${taskId}`);
        },
      },
      queryClient,
      taskChatDraftCleanup: { runMutation: (input) => input.mutation() },
    });

    await commands.removeTaskWorktree("task-1");

    expect(calls).toEqual(["remove:/repo:task-1"]);
    expect(queryClient.getQueryState(impactKey)?.isInvalidated).toBe(true);
  });

  test("invalidates stop impact after a failed close attempt", async () => {
    const queryClient = createQueryClient();
    const stopImpactKey = taskStopImpactQueryKeys.repo({
      workspaceId: "workspace-1",
      repoPath: "/repo",
    });
    queryClient.setQueryData(stopImpactKey, {});
    const commands = createTaskMutationCommands({
      activeRepoPath: "/repo",
      activeWorkspaceId: "workspace-1",
      runTaskMutation: createRunTaskMutation([]),
      hostPort: {
        ...createHostPort(),
        taskClose: async () => {
          throw new Error("close failed");
        },
      },
      queryClient,
      taskChatDraftCleanup: { runMutation: (input) => input.mutation() },
    });

    await expect(commands.closeTask("task-1", { removeWorktree: true })).rejects.toThrow(
      "close failed",
    );
    expect(queryClient.getQueryState(stopImpactKey)?.isInvalidated).toBe(true);
  });
});
