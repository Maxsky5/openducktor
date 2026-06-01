import { describe, expect, mock, test } from "bun:test";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { createTaskCardFixture, enableReactActEnvironment } from "../agent-studio-test-utils";
import { useAgentStudioShellTaskActions } from "./use-agent-studio-shell-task-actions";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioShellTaskActions>[0];

const task = createTaskCardFixture({ id: "task-1", title: "Task 1" });
const activeWorkspace: HookArgs["activeWorkspace"] = {
  workspaceId: "workspace-repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: "/tmp/default-worktrees",
  effectiveWorktreeBasePath: "/tmp/default-worktrees",
};

const createArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeWorkspace,
  tasks: [task],
  selectedTaskId: "task-1",
  detectingPullRequestTaskId: null,
  linkingMergedPullRequestTaskId: null,
  pendingMergedPullRequest: {
    taskId: "task-1",
    pullRequest: {
      providerId: "github",
      number: 268,
      url: "https://github.com/Maxsky5/openducktor/pull/268",
      state: "merged",
      createdAt: "2026-03-20T11:00:00Z",
      updatedAt: "2026-03-20T11:21:32Z",
      lastSyncedAt: "2026-03-20T11:21:32Z",
      mergedAt: "2026-03-20T11:21:32Z",
      closedAt: "2026-03-20T11:21:32Z",
    },
  },
  unlinkingPullRequestTaskId: null,
  syncPullRequests: mock(async () => undefined),
  linkMergedPullRequest: mock(async () => undefined),
  cancelLinkMergedPullRequest: mock(() => undefined),
  unlinkPullRequest: mock(async () => undefined),
  ...overrides,
});

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioShellTaskActions, initialProps);

describe("useAgentStudioShellTaskActions", () => {
  test("wires pull-request actions into task-details and merged PR models", async () => {
    const syncPullRequests = mock(async (_taskId: string) => undefined);
    const unlinkPullRequest = mock(async (_taskId: string) => undefined);
    const linkMergedPullRequest = mock(async () => undefined);
    const cancelLinkMergedPullRequest = mock(() => undefined);
    const args = createArgs({
      syncPullRequests,
      unlinkPullRequest,
      linkMergedPullRequest,
      cancelLinkMergedPullRequest,
    });
    const harness = createHookHarness(args);

    try {
      await harness.mount();

      const state = harness.getLatest();
      state.onDetectPullRequest("task-1");
      state.taskDetailsLauncher.taskDetailsSheetProps.onDetectPullRequest?.("task-2");
      state.taskDetailsLauncher.taskDetailsSheetProps.onUnlinkPullRequest?.("task-3");
      state.mergedPullRequestModal?.onConfirm();
      state.mergedPullRequestModal?.onCancel();

      expect(state.taskDetailsLauncher.taskDetailsSheetProps.allTasks).toBe(args.tasks);
      expect(syncPullRequests).toHaveBeenCalledWith("task-1");
      expect(syncPullRequests).toHaveBeenCalledWith("task-2");
      expect(unlinkPullRequest).toHaveBeenCalledWith("task-3");
      expect(linkMergedPullRequest).toHaveBeenCalled();
      expect(cancelLinkMergedPullRequest).toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("omits the merged PR modal when no merged PR is pending", async () => {
    const harness = createHookHarness(createArgs({ pendingMergedPullRequest: null }));

    try {
      await harness.mount();

      expect(harness.getLatest().mergedPullRequestModal).toBeNull();
    } finally {
      await harness.unmount();
    }
  });
});
