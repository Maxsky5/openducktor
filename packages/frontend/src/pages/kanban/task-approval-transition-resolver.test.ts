import { describe, expect, test } from "bun:test";
import type { TaskAction, TaskApprovalContext, TaskCard } from "@openducktor/contracts";
import type { TaskApprovalFlowState } from "./task-approval-flow-state";
import {
  resolveTaskApprovalOpenMode,
  resolveTaskApprovalSubmissionRoute,
  resolveTaskApprovalWorkflowTransition,
} from "./task-approval-transition-resolver";

type TransitionTask = Pick<TaskCard, "availableActions" | "pullRequest" | "status">;
type TransitionTaskOverrides = Pick<TransitionTask, "availableActions" | "status"> &
  Partial<Pick<TransitionTask, "pullRequest">>;

const task = (overrides: TransitionTaskOverrides): TransitionTask => ({
  pullRequest: undefined,
  ...overrides,
});

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
  providers: [],
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
    approvalContext: approvalContext(),
    ...overrides,
  }) satisfies TaskApprovalFlowState;

describe("resolveTaskApprovalWorkflowTransition", () => {
  test.each([
    {
      name: "approves an AI review task through the direct-merge path",
      command: "approve" as const,
      status: "ai_review" as const,
      availableActions: ["human_approve", "human_request_changes"] satisfies TaskAction[],
      expected: {
        kind: "approved",
        action: "human_approve",
        fromStatus: "ai_review",
        toStatus: "closed",
        completionPath: "direct_merge",
      },
    },
    {
      name: "rejects human review output back into the build loop",
      command: "request_changes" as const,
      status: "human_review" as const,
      availableActions: ["human_approve", "human_request_changes"] satisfies TaskAction[],
      expected: {
        kind: "changes_requested",
        action: "human_request_changes",
        fromStatus: "human_review",
        toStatus: "in_progress",
      },
    },
    {
      name: "rejects AI review output back into the build loop",
      command: "request_changes" as const,
      status: "ai_review" as const,
      availableActions: ["human_approve", "human_request_changes"] satisfies TaskAction[],
      expected: {
        kind: "changes_requested",
        action: "human_request_changes",
        fromStatus: "ai_review",
        toStatus: "in_progress",
      },
    },
    {
      name: "does not approve blocked builder work",
      command: "approve" as const,
      status: "blocked" as const,
      availableActions: ["open_builder", "reset_implementation"] satisfies TaskAction[],
      expected: {
        kind: "unavailable",
        status: "blocked",
        reason: "not_reviewable_status",
        requiredAction: "human_approve",
      },
    },
    {
      name: "does not request changes for blocked builder work",
      command: "request_changes" as const,
      status: "blocked" as const,
      availableActions: ["open_builder", "reset_implementation"] satisfies TaskAction[],
      expected: {
        kind: "unavailable",
        status: "blocked",
        reason: "not_reviewable_status",
        requiredAction: "human_request_changes",
      },
    },
    {
      name: "does not approve resumed rework that is back in progress",
      command: "approve" as const,
      status: "in_progress" as const,
      availableActions: ["open_builder", "build_start"] satisfies TaskAction[],
      expected: {
        kind: "unavailable",
        status: "in_progress",
        reason: "not_reviewable_status",
        requiredAction: "human_approve",
      },
    },
    {
      name: "does not approve review tasks when the required action is unavailable",
      command: "approve" as const,
      status: "human_review" as const,
      availableActions: ["human_request_changes"] satisfies TaskAction[],
      expected: {
        kind: "unavailable",
        status: "human_review",
        reason: "action_unavailable",
        requiredAction: "human_approve",
      },
    },
    {
      name: "approves a human review task through the direct-merge path",
      command: "approve" as const,
      status: "human_review" as const,
      availableActions: ["human_approve"] satisfies TaskAction[],
      expected: {
        kind: "approved",
        action: "human_approve",
        fromStatus: "human_review",
        toStatus: "closed",
        completionPath: "direct_merge",
      },
    },
    {
      name: "approves a PR-linked human review task through the pull-request path",
      command: "approve" as const,
      status: "human_review" as const,
      availableActions: ["human_approve"] satisfies TaskAction[],
      pullRequest: {
        providerId: "github",
        number: 42,
        url: "https://github.com/openai/openducktor/pull/42",
        state: "open",
        createdAt: "2026-05-28T12:00:00.000Z",
        updatedAt: "2026-05-28T12:00:00.000Z",
      } satisfies NonNullable<TaskCard["pullRequest"]>,
      expected: {
        kind: "approved",
        action: "human_approve",
        fromStatus: "human_review",
        toStatus: "closed",
        completionPath: "pull_request",
      },
    },
  ])("$name", ({ command, status, availableActions, expected, pullRequest }) => {
    expect(
      resolveTaskApprovalWorkflowTransition(
        task({
          status,
          availableActions,
          pullRequest,
        }),
        command,
      ),
    ).toEqual(expected);
  });
});

describe("resolveTaskApprovalOpenMode", () => {
  test.each([
    {
      name: "keeps an explicit requested mode",
      requestedMode: "direct_merge" as const,
      cachedContext: approvalContext({
        providers: [{ providerId: "github", enabled: true, available: true }],
      }),
      task: task({
        status: "human_review",
        availableActions: ["human_approve"],
        pullRequest: {
          providerId: "github",
          number: 42,
          url: "https://github.com/openai/openducktor/pull/42",
          state: "open",
          createdAt: "2026-05-28T12:00:00.000Z",
          updatedAt: "2026-05-28T12:00:00.000Z",
        },
      }),
      expected: "direct_merge" as const,
    },
    {
      name: "defaults PR-linked approval to pull request mode",
      requestedMode: undefined,
      cachedContext: undefined,
      task: task({
        status: "human_review",
        availableActions: ["human_approve"],
        pullRequest: {
          providerId: "github",
          number: 42,
          url: "https://github.com/openai/openducktor/pull/42",
          state: "open",
          createdAt: "2026-05-28T12:00:00.000Z",
          updatedAt: "2026-05-28T12:00:00.000Z",
        },
      }),
      expected: "pull_request" as const,
    },
    {
      name: "uses cached provider availability when there is no PR-linked approval",
      requestedMode: undefined,
      cachedContext: approvalContext({
        providers: [{ providerId: "github", enabled: true, available: true }],
      }),
      task: task({ status: "human_review", availableActions: ["human_approve"] }),
      expected: "pull_request" as const,
    },
    {
      name: "uses cached provider availability when approval transition is unavailable",
      requestedMode: undefined,
      cachedContext: approvalContext({
        providers: [{ providerId: "github", enabled: true, available: true }],
      }),
      task: task({
        status: "blocked",
        availableActions: ["open_builder"],
        pullRequest: {
          providerId: "github",
          number: 42,
          url: "https://github.com/openai/openducktor/pull/42",
          state: "open",
          createdAt: "2026-05-28T12:00:00.000Z",
          updatedAt: "2026-05-28T12:00:00.000Z",
        },
      }),
      expected: "pull_request" as const,
    },
    {
      name: "falls back to direct merge when task data is unavailable",
      requestedMode: undefined,
      cachedContext: undefined,
      task: undefined,
      expected: "direct_merge" as const,
    },
    {
      name: "falls back to direct merge without a cached GitHub provider",
      requestedMode: undefined,
      cachedContext: approvalContext(),
      task: task({ status: "blocked", availableActions: ["open_builder"] }),
      expected: "direct_merge" as const,
    },
  ])("$name", ({ cachedContext, expected, requestedMode, task: taskFixture }) => {
    expect(
      resolveTaskApprovalOpenMode({
        cachedContext,
        requestedMode,
        task: taskFixture,
      }),
    ).toBe(expected);
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

    expect(route.kind).toBe("complete_missing_builder_worktree");
    if (route.kind !== "complete_missing_builder_worktree") {
      throw new Error(`Expected missing-builder route, received ${route.kind}`);
    }

    expect(route.approval.stage).toBe("missing_builder_worktree");
    expect(route.approval.taskId).toBe(state.taskId);
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
