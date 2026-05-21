import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import type { TaskStorePort as RealTaskStorePort } from "../../../ports/task-repository-ports";
import type { WorktreeFilePort } from "../../../ports/worktree-file-port";
import {
  createAgentSessionRecord,
  createBuildSettingsConfig,
  createBuildStartGitPort,
  createBuildStartWorktreeFiles,
  createBuildWorkspaceSettingsService,
  createDirectMergeDevServerService,
  createDirectMergeGitPort,
  createDirectMergeTaskWorktreeService,
  extendGitPort,
  task,
} from "../test-support/task-workflow-harness";
import {
  cleanupMergedBuilderState,
  findLatestCleanupTarget,
  loadBuilderBranchCleanup,
  rollbackFailedBuildWorktree,
} from "./builder-worktree-cleanup";

const taskStoreWithTasks = (tasks: ReturnType<typeof task>[]): RealTaskStorePort =>
  ({
    listTasks: () => Effect.succeed(tasks),
  }) as unknown as RealTaskStorePort;

const emptyHooks = {
  preStart: [],
  postComplete: [],
};

describe("builder worktree cleanup", () => {
  test("selects the task worktree before older build sessions when it is on the source branch", async () => {
    const calls: unknown[] = [];
    const cleanupTarget = await Effect.runPromise(
      findLatestCleanupTarget(
        {
          gitPort: createDirectMergeGitPort({
            calls,
            currentBranches: {
              "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
              "/worktrees/repo/session-newer": { name: "odt/task-1", detached: false },
            },
          }),
          settingsConfig: createBuildSettingsConfig(
            new Set(["/worktrees/repo/task-1", "/worktrees/repo/session-newer"]),
          ),
          taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
        },
        taskStoreWithTasks([
          task({
            agentSessions: [
              createAgentSessionRecord({
                externalSessionId: "session-newer",
                startedAt: "2026-05-10T11:00:00.000Z",
                workingDirectory: "/worktrees/repo/session-newer",
              }),
            ],
          }),
        ]),
        "/repo",
        "task-1",
        "odt/task-1",
      ),
    );

    expect(cleanupTarget).toBe("/worktrees/repo/task-1");
    expect(calls).toEqual([{ type: "currentBranch", workingDir: "/worktrees/repo/task-1" }]);
  });

  test("returns a missing latest build session path without probing git", async () => {
    const calls: unknown[] = [];
    const cleanupTarget = await Effect.runPromise(
      findLatestCleanupTarget(
        {
          gitPort: createDirectMergeGitPort({ calls }),
          settingsConfig: createBuildSettingsConfig(new Set()),
          taskWorktreeService: createDirectMergeTaskWorktreeService(null),
        },
        taskStoreWithTasks([
          task({
            agentSessions: [
              createAgentSessionRecord({
                externalSessionId: "session-old",
                startedAt: "2026-05-10T10:00:00.000Z",
                workingDirectory: "/worktrees/repo/session-old",
              }),
              createAgentSessionRecord({
                externalSessionId: "session-new",
                startedAt: "2026-05-10T11:00:00.000Z",
                workingDirectory: "/worktrees/repo/session-new",
              }),
            ],
          }),
        ]),
        "/repo",
        "task-1",
        "odt/task-1",
      ),
    );

    expect(cleanupTarget).toBe("/worktrees/repo/session-new");
    expect(calls).toEqual([]);
  });

  test("removes the selected worktree and force-deletes an unmerged source branch", async () => {
    const calls: unknown[] = [];

    await Effect.runPromise(
      cleanupMergedBuilderState(
        {
          devServerService: createDirectMergeDevServerService(calls),
          gitPort: createDirectMergeGitPort({
            calls,
            currentBranches: {
              "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
            },
            branches: {
              "/repo": [{ name: "odt/task-1", isCurrent: false, isRemote: false }],
            },
            ancestorResults: {
              "/repo|odt/task-1|main": false,
            },
          }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
        },
        taskStoreWithTasks([task()]),
        "/repo",
        "task-1",
        "odt/task-1",
        "main",
      ),
    );

    expect(calls).toEqual([
      { type: "stopDevServers", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "currentBranch", workingDir: "/worktrees/repo/task-1" },
      {
        type: "removeWorktree",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1",
        force: false,
      },
      { type: "listBranches", workingDir: "/repo" },
      { type: "isAncestor", workingDir: "/repo", ancestor: "odt/task-1", descendant: "main" },
      { type: "deleteLocalBranch", repoPath: "/repo", branch: "odt/task-1", force: true },
    ]);
  });

  test("does not remove the repository root when cleanup target normalizes to repo path", async () => {
    const calls: unknown[] = [];

    await Effect.runPromise(
      cleanupMergedBuilderState(
        {
          devServerService: createDirectMergeDevServerService(calls),
          gitPort: createDirectMergeGitPort({
            calls,
            currentBranches: {
              "/repo/./task/..": { name: "odt/task-1", detached: false },
            },
            branches: {
              "/repo": [{ name: "odt/task-1", isCurrent: false, isRemote: false }],
            },
          }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/repo/./task/.."])),
          taskWorktreeService: createDirectMergeTaskWorktreeService("/repo/./task/.."),
        },
        taskStoreWithTasks([task()]),
        "/repo",
        "task-1",
        "odt/task-1",
        "main",
      ),
    );

    expect(calls).not.toContainEqual(
      expect.objectContaining({ type: "removeWorktree", worktreePath: "/repo/./task/.." }),
    );
    expect(calls).toContainEqual({
      type: "deleteLocalBranch",
      repoPath: "/repo",
      branch: "odt/task-1",
      force: false,
    });
  });

  test("propagates worktree removal failures before deleting the branch", async () => {
    const calls: unknown[] = [];

    await expect(
      Effect.runPromise(
        cleanupMergedBuilderState(
          {
            devServerService: createDirectMergeDevServerService(calls),
            gitPort: createDirectMergeGitPort({
              calls,
              currentBranches: {
                "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
              },
              branches: {
                "/repo": [{ name: "odt/task-1", isCurrent: false, isRemote: false }],
              },
              removeWorktreeErrors: {
                "/repo|/worktrees/repo/task-1|false": new Error("git worktree remove failed"),
              },
            }),
            settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
            taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
          },
          taskStoreWithTasks([task()]),
          "/repo",
          "task-1",
          "odt/task-1",
          "main",
        ),
      ),
    ).rejects.toThrow("git worktree remove failed");

    expect(calls).not.toContainEqual(
      expect.objectContaining({ type: "deleteLocalBranch", branch: "odt/task-1" }),
    );
  });

  test("returns actionable rollback cleanup errors for every failed cleanup step", async () => {
    const calls: unknown[] = [];
    const failingWorktreeFiles: WorktreeFilePort = {
      ...createBuildStartWorktreeFiles(calls),
      removePathIfPresent(path) {
        return Effect.fail(
          new HostOperationError({
            operation: "test.removePathIfPresent",
            message: `cannot remove ${path}`,
          }),
        );
      },
    };
    const rollbackMessage = await Effect.runPromise(
      rollbackFailedBuildWorktree(
        {
          gitPort: extendGitPort(createBuildStartGitPort({ calls }), {
            deleteReference(repoPath, reference) {
              calls.push({ type: "deleteReference", repoPath, reference });
              return Effect.fail(
                new HostOperationError({
                  operation: "test.deleteReference",
                  message: "cannot delete tracking ref",
                }),
              );
            },
            deleteLocalBranch(repoPath, branch, force) {
              calls.push({ type: "deleteLocalBranch", repoPath, branch, force });
              return Effect.fail(
                new HostOperationError({
                  operation: "test.deleteLocalBranch",
                  message: "cannot delete branch",
                }),
              );
            },
          }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          worktreeFiles: failingWorktreeFiles,
        } as Parameters<typeof rollbackFailedBuildWorktree>[0],
        "/repo",
        "/worktrees/repo/task-1",
        "odt/task-1",
        "refs/remotes/origin/odt/task-1",
      ),
    );

    expect(rollbackMessage).toContain(
      "Also failed to delete created upstream tracking ref refs/remotes/origin/odt/task-1: cannot delete tracking ref",
    );
    expect(rollbackMessage).toContain(
      "Also failed to remove worktree /worktrees/repo/task-1: git worktree removal left filesystem path cleanup incomplete for /worktrees/repo/task-1",
    );
    expect(rollbackMessage).toContain(
      "Also failed to delete branch odt/task-1: cannot delete branch",
    );
  });

  test("loads source and target branches from the builder worktree", async () => {
    const calls: unknown[] = [];
    const branchCleanup = await Effect.runPromise(
      loadBuilderBranchCleanup(
        {
          gitPort: createDirectMergeGitPort({
            calls,
            currentBranches: {
              "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
            },
          }),
          taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: emptyHooks,
            defaultTargetBranch: { remote: "origin", branch: "main" },
          }),
        },
        task(),
        "/repo",
        "task-1",
        "direct_merge",
      ),
    );

    expect(branchCleanup).toEqual({ sourceBranch: "odt/task-1", targetBranch: "main" });
  });

  test("rejects missing, detached, and unnamed builder worktrees with actionable messages", async () => {
    await expect(
      Effect.runPromise(
        loadBuilderBranchCleanup(
          {
            gitPort: createDirectMergeGitPort({ calls: [] }),
            taskWorktreeService: createDirectMergeTaskWorktreeService(null),
            workspaceSettingsService: createBuildWorkspaceSettingsService({
              workspaceId: "repo",
              repoPath: "/repo",
              hooks: emptyHooks,
            }),
          },
          task(),
          "/repo",
          "task-1",
          "direct_merge",
        ),
      ),
    ).rejects.toThrow(
      "direct_merge requires a builder worktree for task task-1. Start Builder first.",
    );

    await expect(
      Effect.runPromise(
        loadBuilderBranchCleanup(
          {
            gitPort: createDirectMergeGitPort({
              calls: [],
              currentBranches: {
                "/worktrees/repo/task-1": { detached: true },
              },
            }),
            taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
            workspaceSettingsService: createBuildWorkspaceSettingsService({
              workspaceId: "repo",
              repoPath: "/repo",
              hooks: emptyHooks,
            }),
          },
          task(),
          "/repo",
          "task-1",
          "direct_merge",
        ),
      ),
    ).rejects.toThrow(
      "direct_merge requires a builder branch, but the builder worktree is detached.",
    );

    await expect(
      Effect.runPromise(
        loadBuilderBranchCleanup(
          {
            gitPort: createDirectMergeGitPort({
              calls: [],
              currentBranches: {
                "/worktrees/repo/task-1": { name: " ", detached: false },
              },
            }),
            taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
            workspaceSettingsService: createBuildWorkspaceSettingsService({
              workspaceId: "repo",
              repoPath: "/repo",
              hooks: emptyHooks,
            }),
          },
          task(),
          "/repo",
          "task-1",
          "direct_merge",
        ),
      ),
    ).rejects.toThrow("direct_merge requires a builder branch name.");
  });
});
