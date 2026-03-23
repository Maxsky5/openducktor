import { afterEach, describe, expect, mock, test } from "bun:test";
import { host } from "@/state/operations/shared/host";
import { resolveQaBuilderSessionContext } from "./build-worktree-overrides";

const originalBuildContinuationTargetGet = host.buildContinuationTargetGet;

describe("resolveQaBuilderSessionContext", () => {
  afterEach(() => {
    host.buildContinuationTargetGet = originalBuildContinuationTargetGet;
  });

  test("uses the host continuation target as the QA builder context", async () => {
    const buildContinuationTargetGetMock = mock(async () => ({
      workingDirectory: "/repo/worktrees/task-1",
      source: "builder_session" as const,
    }));
    host.buildContinuationTargetGet = buildContinuationTargetGetMock;

    const context = await resolveQaBuilderSessionContext({
      activeRepo: "/repo",
      taskId: "task-1",
    });

    expect(buildContinuationTargetGetMock).toHaveBeenCalledWith("/repo", "task-1");
    expect(context).toEqual({
      workingDirectory: "/repo/worktrees/task-1",
    });
  });

  test("throws when active repository is missing", async () => {
    const buildContinuationTargetGetMock = mock(async () => ({
      workingDirectory: "/repo/worktrees/task-1",
      source: "active_build_run" as const,
    }));
    host.buildContinuationTargetGet = buildContinuationTargetGetMock;

    await expect(
      resolveQaBuilderSessionContext({
        activeRepo: null,
        taskId: "task-1",
      }),
    ).rejects.toThrow("No active repository selected.");

    expect(buildContinuationTargetGetMock).not.toHaveBeenCalled();
  });

  test("propagates host continuation target failures", async () => {
    const buildContinuationTargetGetMock = mock(async () => {
      throw new Error("no builder worktree");
    });
    host.buildContinuationTargetGet = buildContinuationTargetGetMock;

    await expect(
      resolveQaBuilderSessionContext({
        activeRepo: "/repo",
        taskId: "task-1",
      }),
    ).rejects.toThrow("no builder worktree");

    expect(buildContinuationTargetGetMock).toHaveBeenCalledWith("/repo", "task-1");
  });

  test("passes through host working directory without local normalization", async () => {
    const buildContinuationTargetGetMock = mock(async () => ({
      workingDirectory: "/repo/worktrees/task-1/",
      source: "builder_session" as const,
    }));
    host.buildContinuationTargetGet = buildContinuationTargetGetMock;

    const context = await resolveQaBuilderSessionContext({
      activeRepo: "/repo",
      taskId: "task-1",
    });

    expect(context).toEqual({
      workingDirectory: "/repo/worktrees/task-1/",
    });
  });
});
