import { describe, expect, test } from "bun:test";
import type { TaskApprovalContext } from "@openducktor/contracts";
import { createGitProviderContextFixture } from "../../test-support/shared-test-fixtures";
import type { TaskApprovalFlowState } from "./task-approval-flow-state";
import {
  resolveCurrentTaskApprovalMode,
  resolveTaskApprovalOpenMode,
  resolveTaskApprovalSubmissionRoute,
} from "./task-approval-transition-resolver";

const approvalContext = (overrides: Partial<TaskApprovalContext> = {}): TaskApprovalContext => ({
  taskId: "TASK-1",
  taskStatus: "human_review",
  workingDirectory: "/repo/.worktrees/TASK-1",
  sourceBranch: "odt/TASK-1",
  targetBranch: { remote: "origin", branch: "main" },
  publishTarget: { remote: "origin", branch: "main" },
  defaultMergeMethod: "merge_commit",
  hasUncommittedChanges: false,
  uncommittedFileCount: 0,
  pullRequest: undefined,
  directMerge: undefined,
  suggestedSquashCommitMessage: undefined,
  ...overrides,
});

const openState = (overrides: Partial<Extract<TaskApprovalFlowState, { kind: "open" }>> = {}) =>
  ({
    kind: "open",
    phase: "ready",
    stage: "approval",
    taskId: "TASK-1",
    mode: "direct_merge",
    mergeMethod: "merge_commit",
    pullRequestDraftMode: "manual",
    title: "Task",
    body: "",
    squashCommitMessage: "",
    squashCommitMessageTouched: false,
    errorMessage: null,
    errorOutcomeUnknown: false,
    approvalContext: approvalContext(),
    approvalContextError: null,
    workspaceIdentity: { workspaceId: "workspace-repo", repoPath: "/repo" },
    ...overrides,
  }) satisfies TaskApprovalFlowState;

describe("resolveTaskApprovalOpenMode", () => {
  test.each([
    {
      name: "keeps an explicit requested mode",
      requestedMode: "direct_merge" as const,
      gitProviderContext: createGitProviderContextFixture(),
      expected: "direct_merge" as const,
    },
    {
      name: "defaults to Pull Request mode when the provider supports it",
      requestedMode: undefined,
      gitProviderContext: createGitProviderContextFixture(),
      expected: "pull_request" as const,
    },
    {
      name: "keeps Pull Request mode when health is unavailable",
      requestedMode: undefined,
      gitProviderContext: createGitProviderContextFixture({ available: false }),
      expected: "pull_request" as const,
    },
    {
      name: "falls back to direct merge when no provider is configured",
      requestedMode: undefined,
      gitProviderContext: null,
      expected: "direct_merge" as const,
    },
    {
      name: "falls back to direct merge when Pull Requests are unsupported",
      requestedMode: undefined,
      gitProviderContext: createGitProviderContextFixture({ supportsPullRequests: false }),
      expected: "direct_merge" as const,
    },
  ])("$name", ({ gitProviderContext, expected, requestedMode }) => {
    expect(
      resolveTaskApprovalOpenMode({
        gitProviderContext,
        requestedMode,
      }),
    ).toBe(expected);
  });
});

describe("resolveCurrentTaskApprovalMode", () => {
  test.each([
    {
      name: "keeps Pull Request mode while the provider read is pending",
      gitProviderContext: undefined,
      expected: "pull_request" as const,
    },
    {
      name: "keeps Pull Request mode when the provider supports it",
      gitProviderContext: createGitProviderContextFixture({ available: false }),
      expected: "pull_request" as const,
    },
    {
      name: "uses Direct Merge when the current provider does not support Pull Requests",
      gitProviderContext: createGitProviderContextFixture({ supportsPullRequests: false }),
      expected: "direct_merge" as const,
    },
    {
      name: "uses Direct Merge when no provider is configured",
      gitProviderContext: null,
      expected: "direct_merge" as const,
    },
  ])("$name", ({ expected, gitProviderContext }) => {
    expect(resolveCurrentTaskApprovalMode("pull_request", gitProviderContext)).toBe(expected);
  });
});

describe("resolveTaskApprovalSubmissionRoute", () => {
  test.each([
    {
      name: "ignores closed state",
      state: { kind: "closed" } satisfies TaskApprovalFlowState,
      repoPath: "/repo",
    },
    {
      name: "ignores a loading approval state",
      state: openState({ phase: "loading" }),
      repoPath: "/repo",
    },
    {
      name: "ignores a submitting approval state",
      state: openState({ phase: "submitting" }),
      repoPath: "/repo",
    },
    {
      name: "ignores approval submission when the workspace repo path is missing",
      state: openState(),
      repoPath: null,
    },
    {
      name: "ignores approval submission when approval context is missing",
      state: openState({ approvalContext: null }),
      repoPath: "/repo",
    },
    {
      name: "ignores direct merge completion state",
      state: openState({ stage: "complete_direct_merge" }),
      repoPath: "/repo",
    },
  ])("$name", ({ repoPath, state }) => {
    expect(resolveTaskApprovalSubmissionRoute(state, repoPath)).toEqual({ kind: "ignore" });
  });

  test("routes missing builder worktree completion without requiring a repo path", () => {
    const state = openState({
      stage: "missing_builder_worktree",
      approvalContext: null,
    });
    const route = resolveTaskApprovalSubmissionRoute(state, null);

    expect(route.kind).toBe("close_missing_builder_worktree");
    if (route.kind !== "close_missing_builder_worktree") {
      throw new Error(`Expected missing-builder route, received ${route.kind}`);
    }

    expect(route.approval.stage).toBe("missing_builder_worktree");
    expect(route.approval.taskId).toBe(state.taskId);
  });

  test("routes Close Task when the approval context read failed", () => {
    const failed = openState({
      mode: "close_task",
      approvalContext: null,
      approvalContextError: "The task worktree has a detached HEAD.",
    });

    expect(resolveTaskApprovalSubmissionRoute(failed, "/repo").kind).toBe("close_task");
    expect(
      resolveTaskApprovalSubmissionRoute({ ...failed, mode: "direct_merge" }, "/repo").kind,
    ).toBe("ignore");
  });

  test("routes direct merge submissions with the repo path", () => {
    const route = resolveTaskApprovalSubmissionRoute(openState({ mode: "direct_merge" }), "/repo");

    expect(route.kind).toBe("submit_direct_merge");
    if (route.kind !== "submit_direct_merge") {
      throw new Error(`Expected direct-merge route, received ${route.kind}`);
    }

    expect(route.repoPath).toBe("/repo");
    expect(route.approval.mode).toBe("direct_merge");
  });

  test("routes pull request submissions with the repo path", () => {
    const route = resolveTaskApprovalSubmissionRoute(openState({ mode: "pull_request" }), "/repo");

    expect(route.kind).toBe("submit_pull_request");
    if (route.kind !== "submit_pull_request") {
      throw new Error(`Expected pull-request route, received ${route.kind}`);
    }

    expect(route.repoPath).toBe("/repo");
    expect(route.approval.mode).toBe("pull_request");
  });
});
