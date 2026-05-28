import { describe, expect, test } from "bun:test";
import type { TaskAction, TaskCard, TaskStatus } from "@openducktor/contracts";
import { resolveTaskApprovalWorkflowTransition } from "./task-approval-transition-resolver";

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
