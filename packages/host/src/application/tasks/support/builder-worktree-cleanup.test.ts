import { describe, expect, test } from "bun:test";
import {
  type AgentRole,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeDescriptor,
  type RuntimeSupportedScope,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import type { TaskStorePort as RealTaskStorePort } from "../../../ports/task-repository-ports";
import type { WorktreeFilePort } from "../../../ports/worktree-file-port";
import type { TaskTerminalCleanupPort } from "../task-service";
import {
  createAgentSessionRecord,
  createBuildSettingsConfig,
  createBuildStartGitPort,
  createBuildStartRuntimeRegistry,
  createBuildStartWorktreeFiles,
  createBuildSystemCommands,
  createBuildWorkspaceSettingsService,
  createDirectMergeDevServerService,
  createDirectMergeGitPort,
  createDirectMergeTaskWorktreeService,
  createRuntimeDefinitionsService,
  extendGitPort,
  task,
} from "../test-support/task-workflow-harness";
import {
  cleanupMergedBuilderState,
  findLatestCleanupTarget,
  loadBuilderBranchCleanup,
  resolveRuntimeDescriptorForTaskSession,
  rollbackFailedBuildWorktree,
} from "./builder-worktree-cleanup";
import { requireBuildStartDependencies } from "./required-task-dependencies";

const taskStoreWithTasks = (
  tasks: ReturnType<typeof task>[],
  sessionsByTaskId: Record<string, ReturnType<typeof createAgentSessionRecord>[]> = {},
): RealTaskStorePort =>
  ({
    clearAgentSessionsByRoles: () => Effect.dieMessage("unexpected clearAgentSessionsByRoles"),
    clearQaReports: () => Effect.dieMessage("unexpected clearQaReports"),
    clearWorkflowDocuments: () => Effect.dieMessage("unexpected clearWorkflowDocuments"),
    createTask: () => Effect.dieMessage("unexpected createTask"),
    deleteAgentSession: () => Effect.dieMessage("unexpected deleteAgentSession"),
    deleteTask: () => Effect.dieMessage("unexpected deleteTask"),
    diagnoseRepoStore: () => Effect.dieMessage("unexpected diagnoseRepoStore"),
    getTask: () => Effect.dieMessage("unexpected getTask"),
    getTaskMetadata: ({ taskId }) =>
      Effect.succeed({
        spec: { markdown: "" },
        plan: { markdown: "" },
        agentSessions: sessionsByTaskId[taskId] ?? [],
      }),
    listPullRequestSyncCandidates: () =>
      Effect.dieMessage("unexpected listPullRequestSyncCandidates"),
    listAgentSessionsForTasks: () => Effect.dieMessage("unexpected listAgentSessionsForTasks"),
    listTasks: () => Effect.succeed(tasks),
    recordQaOutcome: () => Effect.dieMessage("unexpected recordQaOutcome"),
    setDirectMerge: () => Effect.dieMessage("unexpected setDirectMerge"),
    setPlanDocument: () => Effect.dieMessage("unexpected setPlanDocument"),
    setPullRequest: () => Effect.dieMessage("unexpected setPullRequest"),
    setSpecDocument: () => Effect.dieMessage("unexpected setSpecDocument"),
    transitionTask: () => Effect.dieMessage("unexpected transitionTask"),
    updateTask: () => Effect.dieMessage("unexpected updateTask"),
    upsertAgentSession: () => Effect.dieMessage("unexpected upsertAgentSession"),
  }) satisfies RealTaskStorePort;

const emptyHooks = {
  preStart: [],
  postComplete: [],
};

const createTerminalCleanupService = (calls: unknown[]): TaskTerminalCleanupPort => ({
  acquireTaskCleanup: ({ repoPath, taskIds }) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        calls.push({ type: "acquireTerminalCleanup", repoPath, taskIds });
        return { closedTerminalIds: [] };
      }),
      () =>
        Effect.sync(() => {
          calls.push({ type: "releaseTerminalCleanup" });
        }),
    ),
});

const runtimeDefinitionsWithScopes = (
  supportedScopes: RuntimeSupportedScope[],
): { listRuntimeDefinitions(): RuntimeDescriptor[] } => ({
  listRuntimeDefinitions: () => [
    {
      ...RUNTIME_DESCRIPTORS_BY_KIND.opencode,
      capabilities: {
        ...RUNTIME_DESCRIPTORS_BY_KIND.opencode.capabilities,
        workflow: {
          ...RUNTIME_DESCRIPTORS_BY_KIND.opencode.capabilities.workflow,
          supportedScopes,
        },
      },
    },
  ],
});

describe("builder worktree cleanup", () => {
  test.each([
    ["spec", ["workspace"]],
    ["planner", ["workspace"]],
    ["qa", ["task"]],
    ["build", ["build", "workspace"]],
  ] satisfies Array<[AgentRole, RuntimeSupportedScope[]]>)(
    "accepts the shared %s runtime scope contract",
    async (role, supportedScopes) => {
      await expect(
        Effect.runPromise(
          resolveRuntimeDescriptorForTaskSession(
            runtimeDefinitionsWithScopes(supportedScopes),
            "opencode",
            role,
          ),
        ),
      ).resolves.toMatchObject({ kind: "opencode" });
    },
  );

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
        taskStoreWithTasks([task()], {
          "task-1": [
            createAgentSessionRecord({
              externalSessionId: "session-newer",
              startedAt: "2026-05-10T11:00:00.000Z",
              workingDirectory: "/worktrees/repo/session-newer",
            }),
          ],
        }),
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
        taskStoreWithTasks([task()], {
          "task-1": [
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
        "/repo",
        "task-1",
        "odt/task-1",
      ),
    );

    expect(cleanupTarget).toBe("/worktrees/repo/session-new");
    expect(calls).toEqual([]);
  });

  test("returns undefined when every cleanup candidate is unusable", async () => {
    const calls: unknown[] = [];
    const cleanupTarget = await Effect.runPromise(
      findLatestCleanupTarget(
        {
          gitPort: createDirectMergeGitPort({
            calls,
            currentBranches: {
              "/worktrees/repo/detached": { detached: true },
              "/worktrees/repo/wrong-branch": { name: "odt/other-task", detached: false },
            },
          }),
          settingsConfig: createBuildSettingsConfig(
            new Set(["/worktrees/repo/detached", "/worktrees/repo/wrong-branch"]),
          ),
          taskWorktreeService: createDirectMergeTaskWorktreeService(null),
        },
        taskStoreWithTasks([task()], {
          "task-1": [
            createAgentSessionRecord({
              externalSessionId: "session-empty",
              startedAt: "2026-05-10T12:00:00.000Z",
              workingDirectory: " ",
            }),
            createAgentSessionRecord({
              externalSessionId: "session-detached",
              startedAt: "2026-05-10T11:00:00.000Z",
              workingDirectory: "/worktrees/repo/detached",
            }),
            createAgentSessionRecord({
              externalSessionId: "session-wrong-branch",
              startedAt: "2026-05-10T10:00:00.000Z",
              workingDirectory: "/worktrees/repo/wrong-branch",
            }),
          ],
        }),
        "/repo",
        "task-1",
        "odt/task-1",
      ),
    );

    expect(cleanupTarget).toBeUndefined();
    expect(calls).toEqual([
      { type: "currentBranch", workingDir: "/worktrees/repo/detached" },
      { type: "currentBranch", workingDir: "/worktrees/repo/wrong-branch" },
    ]);
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
          terminalService: createTerminalCleanupService(calls),
        },
        taskStoreWithTasks([task()]),
        "/repo",
        "task-1",
        "odt/task-1",
        "main",
      ),
    );

    expect(calls).toEqual([
      { type: "acquireTerminalCleanup", repoPath: "/repo", taskIds: ["task-1"] },
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
      { type: "releaseTerminalCleanup" },
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
          terminalService: createTerminalCleanupService(calls),
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
            terminalService: createTerminalCleanupService(calls),
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
        requireBuildStartDependencies(
          extendGitPort(createBuildStartGitPort({ calls }), {
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
          createRuntimeDefinitionsService(),
          createBuildStartRuntimeRegistry(calls),
          createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          createBuildSystemCommands(calls),
          failingWorktreeFiles,
          createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: emptyHooks,
          }),
        ),
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
