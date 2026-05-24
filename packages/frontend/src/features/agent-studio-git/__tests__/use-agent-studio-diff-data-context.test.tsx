import { describe, expect, test } from "bun:test";
import {
  createBaseArgs,
  createHookHarness,
  gitFetchRemoteMock,
  gitGetWorktreeStatusMock,
  retryWorktreeResolutionMock,
  setupAgentStudioDiffDataTestHarness,
  taskWorktreeEntriesMock,
} from "../test-support/diff-data-test-harness";

setupAgentStudioDiffDataTestHarness();

describe("useAgentStudioDiffData", () => {
  test("resets diff scope to uncommitted when repository context changes", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      repoPath: "/repo-a",
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      await harness.waitFor((state) => state.diffScope === "target");

      await harness.update({
        ...createBaseArgs(),
        repoPath: "/repo-b",
      });

      await harness.waitFor((state) => state.diffScope === "uncommitted");
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 3);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        3,
        "/repo-b",
        "origin/main",
        "uncommitted",
        undefined,
      );
    } finally {
      await harness.unmount();
    }
  });

  test("resets cached diff data when switching between task worktrees", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      worktreeResolutionTaskId: "task-a",
      worktreePath: "/repo/.worktrees/task-a",
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      await harness.waitFor((state) => state.diffScope === "target");

      await harness.update({
        ...createBaseArgs(),
        worktreeResolutionTaskId: "task-b",
        worktreePath: "/repo/.worktrees/task-b",
      });

      await harness.waitFor((state) => state.diffScope === "uncommitted");
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 3);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        3,
        "/repo",
        "origin/main",
        "uncommitted",
        "/repo/.worktrees/task-b",
      );
      expect(harness.getLatest().worktreePath).toBe("/repo/.worktrees/task-b");
    } finally {
      await harness.unmount();
    }
  });

  test("reloads inactive scope after repository context changes", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      repoPath: "/repo-a",
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(2);

      await harness.update({
        ...createBaseArgs(),
        repoPath: "/repo-b",
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 3);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        3,
        "/repo-b",
        "origin/main",
        "uncommitted",
        undefined,
      );

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 4);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        4,
        "/repo-b",
        "origin/main",
        "target",
        undefined,
      );
    } finally {
      await harness.unmount();
    }
  });

  test("blocks diff loading while the snapshot reports worktree resolution is pending", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      worktreeResolutionTaskId: "run-1",
      shouldBlockDiffLoading: true,
      isWorktreeResolutionResolving: true,
    });

    try {
      await harness.mount();
      await harness.run(async () => {
        await Promise.resolve();
      });

      expect(gitGetWorktreeStatusMock).not.toHaveBeenCalled();
      expect(harness.getLatest().worktreePath).toBeNull();
      expect(harness.getLatest().isLoading).toBe(true);
    } finally {
      await harness.unmount();
    }
  });

  test("refresh retries snapshot-owned worktree resolution before loading diff data", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      worktreeResolutionTaskId: "run-1",
      shouldBlockDiffLoading: true,
      worktreeResolutionError:
        "Failed to resolve task worktree path for task run-1. Use Refresh to retry.",
    });

    try {
      await harness.mount();
      expect(gitGetWorktreeStatusMock).not.toHaveBeenCalled();

      await harness.run(async (state) => {
        await state.refresh();
      });

      expect(retryWorktreeResolutionMock).toHaveBeenCalledTimes(1);
      expect(gitGetWorktreeStatusMock).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("blocks diff loading and reports actionable error when task target branch metadata is invalid", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      preconditionError:
        "Invalid openducktor.targetBranch metadata: missing field `branch`. Fix the saved task metadata or choose a valid target branch again.",
    });

    try {
      await harness.mount();
      await harness.waitFor(
        (state) =>
          state.error ===
          "Invalid openducktor.targetBranch metadata: missing field `branch`. Fix the saved task metadata or choose a valid target branch again.",
      );

      expect(taskWorktreeEntriesMock).not.toHaveBeenCalled();
      expect(gitGetWorktreeStatusMock).not.toHaveBeenCalled();
      expect(harness.getLatest().worktreePath).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("blocks diff loading and refresh while the selected runtime is unavailable", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      preconditionError:
        "Runtime unavailable for this task. Select an available runtime before loading git diff data.",
    });

    try {
      await harness.mount();
      await harness.waitFor(
        (state) =>
          state.error ===
          "Runtime unavailable for this task. Select an available runtime before loading git diff data.",
      );

      await harness.run(async (state) => {
        await state.refresh();
      });

      expect(gitFetchRemoteMock).not.toHaveBeenCalled();
      expect(gitGetWorktreeStatusMock).not.toHaveBeenCalled();
      expect(retryWorktreeResolutionMock).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });
});
