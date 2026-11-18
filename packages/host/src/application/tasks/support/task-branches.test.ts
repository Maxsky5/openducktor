import { specPlanBuildWorkflow } from "@openducktor/workflows";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createGitPortTestDouble } from "../../../test-support/service-test-doubles";
import {
  createBuildWorkspaceSettingsService,
  createDirectMergeGitPort,
  createDirectMergeTaskWorktreeService,
  task,
} from "../test-support/task-workflow-harness";
import { requireTaskBranches, resolveTaskWorktreeStartPoint } from "./task-branches";

const worktreePath = "/worktrees/repo/task-1";
const target = { remote: "origin", branch: "main" };

const scope = {
  workspaceId: "repo",
  repoPath: "/repo",
};
const branchInput = {
  ...scope,
  workflow: specPlanBuildWorkflow,
  operationLabel: "direct_merge",
};
const workspaceSettingsService = createBuildWorkspaceSettingsService({
  ...scope,
  hooks: { beforeWorktreeRemoval: [] },
  defaultTargetBranch: target,
});

describe("requireTaskBranches", () => {
  test("loads source and target branches from the task worktree", async () => {
    const branches = await Effect.runPromise(
      requireTaskBranches(
        {
          gitPort: createDirectMergeGitPort({
            calls: [],
            currentBranches: { [worktreePath]: { name: "odt/task-1", detached: false } },
          }),
          taskWorktreeService: createDirectMergeTaskWorktreeService(worktreePath),
          workspaceSettingsService,
        },
        { ...branchInput, task: task() },
      ),
    );

    expect(branches).toEqual({ sourceBranch: "odt/task-1", targetBranch: "main" });
  });

  test.each([
    {
      path: null,
      currentBranch: { detached: true },
      message:
        "direct_merge requires a task worktree for task task-1. Start a Builder or QA session first.",
    },
    {
      path: worktreePath,
      currentBranch: { detached: true },
      message: "direct_merge requires a task branch, but the task worktree is detached.",
    },
    {
      path: worktreePath,
      currentBranch: { name: " ", detached: false },
      message: "direct_merge requires a task branch name.",
    },
  ])(
    "rejects an unavailable task branch with $message",
    async ({ path, currentBranch, message }) => {
      await expect(
        Effect.runPromise(
          requireTaskBranches(
            {
              gitPort: createDirectMergeGitPort({
                calls: [],
                currentBranches: { [worktreePath]: currentBranch },
              }),
              taskWorktreeService: createDirectMergeTaskWorktreeService(path),
              workspaceSettingsService,
            },
            { ...branchInput, task: task() },
          ),
        ),
      ).rejects.toThrow(message);
    },
  );
});

describe("resolveTaskWorktreeStartPoint", () => {
  const gitPortWith = (references: string[]) =>
    createGitPortTestDouble({
      referenceExists: (_repoPath, reference) => Effect.succeed(references.includes(reference)),
    });

  test("uses a target branch that exists", async () => {
    const start = await Effect.runPromise(
      resolveTaskWorktreeStartPoint(
        { gitPort: gitPortWith(["origin/main"]), workspaceSettingsService },
        { ...scope, task: task({ targetBranch: target }) },
      ),
    );

    expect(start).toEqual({ reference: "origin/main", upstreamRemote: "origin" });
  });

  test("uses the local counterpart of a missing workspace default on origin", async () => {
    const start = await Effect.runPromise(
      resolveTaskWorktreeStartPoint(
        { gitPort: gitPortWith(["main"]), workspaceSettingsService },
        { ...scope, task: task() },
      ),
    );

    expect(start).toEqual({ reference: "main", upstreamRemote: null });
  });

  test("tells the user to choose an existing branch when the explicit target is missing", async () => {
    const failure = await Effect.runPromise(
      Effect.flip(
        resolveTaskWorktreeStartPoint(
          { gitPort: gitPortWith(["main"]), workspaceSettingsService },
          { ...scope, task: task({ targetBranch: target }) },
        ),
      ),
    );

    expect(failure.message).toBe(
      "Target branch origin/main does not exist in this repository. Choose an existing target branch, or fetch this branch first.",
    );
  });
});
