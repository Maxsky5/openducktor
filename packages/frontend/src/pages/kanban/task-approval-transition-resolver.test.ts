import { describe, expect, test } from "bun:test";
import type { TaskAction, TaskApprovalContext, TaskCard, TaskStatus } from "@openducktor/contracts";
import type { TaskApprovalFlowState } from "./task-approval-flow-state";
import {
  resolveTaskApprovalOpenMode,
  resolveTaskApprovalSubmissionRoute,
  resolveTaskApprovalWorkflowTransition,
} from "./task-approval-transition-resolver";

type TaskFixtureOverrides = Pick<TaskCard, "status" | "availableActions"> & Partial<TaskCard>;

const task = ({ status, availableActions, ...overrides }: TaskFixtureOverrides): TaskCard => ({
  id: "TASK-1",
  title: "Task",
  description: "",
  notes: "",
  status,
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions,
  labels: [],
  assignee: undefined,
  parentId: undefined,
  subtaskIds: [],
  agentSessions: [],
  targetBranch: undefined,
  targetBranchError: undefined,
  pullRequest: undefined,
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-05-28T12:00:00.000Z",
  createdAt: "2026-05-28T11:00:00.000Z",
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
          status: status satisfies TaskStatus,
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
      expectedKind: "ignore",
    },
    {
      name: "ignores a loading approval state",
      state: openState({ phase: "loading" }),
      repoPath: "/repo",
      expectedKind: "ignore",
    },
    {
      name: "ignores a submitting approval state",
      state: openState({ phase: "submitting" }),
      repoPath: "/repo",
      expectedKind: "ignore",
    },
    {
      name: "routes missing builder worktree completion without requiring a repo path",
      state: openState({
        stage: "missing_builder_worktree",
        approvalContext: null,
      }),
      repoPath: null,
      expectedKind: "complete_missing_builder_worktree",
    },
    {
      name: "ignores approval submission when the workspace repo path is missing",
      state: openState(),
      repoPath: null,
      expectedKind: "ignore",
    },
    {
      name: "ignores approval submission when approval context is missing",
      state: openState({ approvalContext: null }),
      repoPath: "/repo",
      expectedKind: "ignore",
    },
    {
      name: "routes direct merge submissions with the repo path",
      state: openState({ mode: "direct_merge" }),
      repoPath: "/repo",
      expectedKind: "submit_direct_merge",
    },
    {
      name: "routes pull request submissions with the repo path",
      state: openState({ mode: "pull_request" }),
      repoPath: "/repo",
      expectedKind: "submit_pull_request",
    },
  ])("$name", ({ expectedKind, repoPath, state }) => {
    const route = resolveTaskApprovalSubmissionRoute(state, repoPath);

    expect(route.kind).toBe(expectedKind);
    if (route.kind !== "ignore") {
      expect(Object.is(route.approval, state)).toBe(true);
    }
    if (route.kind === "submit_direct_merge" || route.kind === "submit_pull_request") {
      expect(route.repoPath).toBe("/repo");
    }
  });
});
