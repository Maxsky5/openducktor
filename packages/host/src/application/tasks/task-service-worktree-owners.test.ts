import { describe, expect, test } from "bun:test";
import type { TaskWorktreeOwners, TaskWorktreeOwnersOperation } from "@openducktor/contracts";
import { Effect } from "effect";
import type { TaskWorktreeOwnerReader } from "../../ports/task-worktree-owner-port";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import {
  createBuildSettingsConfig,
  createBuildWorkspaceSettingsService,
  createDirectMergeGitPort,
  createTaskService,
  task,
} from "./test-support/task-workflow-harness";

const worktreePath = "/worktrees/repo/task-1";
const result: TaskWorktreeOwners = {
  owners: {
    checkoutWorkspaces: [],
    tasks: [],
    chats: [{ workspaceId: "repo", sessionId: "chat-1", title: "Hi" }],
    historyChats: [],
  },
  historyReadErrors: ["Cannot check the native history of saved session “Fork”."],
};

const createService = (status: "in_progress" | "closed", reads: unknown[]) => {
  const reader: TaskWorktreeOwnerReader = {
    readOwners: (input) =>
      Effect.sync(() => {
        reads.push(input);
        return result;
      }),
  };
  return createTaskService({
    taskWorkflows: builtinTaskWorkflows,
    gitPort: createDirectMergeGitPort({ calls: [] }),
    settingsConfig: createBuildSettingsConfig(new Set(["/repo", worktreePath])),
    taskStore: {
      getTask: () => Effect.succeed(task({ status })),
      getTaskMetadata: () => Effect.succeed({ artifacts: {}, agentSessions: [] }),
    },
    taskWorktreeService: {
      getTaskWorktree: () => Effect.succeed({ workingDirectory: worktreePath }),
    },
    workspaceSettingsService: createBuildWorkspaceSettingsService({
      workspaceId: "repo",
      repoPath: "/repo",
      hooks: { beforeWorktreeRemoval: [] },
    }),
    worktreeOwners: reader,
  });
};

const readOwners = (
  service: ReturnType<typeof createService>,
  operation: TaskWorktreeOwnersOperation,
) =>
  Effect.runPromise(
    service.getTaskWorktreeOwners({
      workspaceId: "repo",
      repoPath: "/repo",
      taskIds: ["task-1"],
      operation,
    }),
  );

describe("getTaskWorktreeOwners", () => {
  test.each(["close", "delete", "reset_task"] as const)(
    "%s reads the owners of the worktrees that it removes, and reports history read failures",
    async (operation) => {
      const reads: unknown[] = [];

      expect(await readOwners(createService("in_progress", reads), operation)).toEqual(result);
      expect(reads).toEqual([
        {
          workspaceId: "repo",
          repoPath: "/repo",
          taskIds: ["task-1"],
          worktreePaths: [worktreePath],
          history: "report",
        },
      ]);
    },
  );

  test("Remove worktree reads the worktree of a closed task, which Close no longer removes", async () => {
    const reads: unknown[] = [];
    const service = createService("closed", reads);

    expect(await readOwners(service, "remove_worktree")).toEqual(result);
    expect(reads).toEqual([
      {
        workspaceId: "repo",
        repoPath: "/repo",
        taskIds: ["task-1"],
        worktreePaths: [worktreePath],
        history: "report",
      },
    ]);
    expect((await readOwners(service, "close")).owners.chats).toEqual([]);
    expect(reads).toHaveLength(1);
  });
});
