import { describe, expect, test } from "bun:test";
import { workflowDefinitionSchema } from "@openducktor/contracts";
import { createTaskCardFixture } from "../test-support/task-card-fixture";
import { reviewTaskDefinition } from "../test-support/review-task-workflow";
import { createWorkflow } from "./evaluate";
import {
  resolveTaskCardActions,
  resolveWorkflowAction,
  taskActionLabel,
} from "./task-presentation";
import {
  roleDefaultPanel,
  roleFocusArtifact,
  taskLaunchOrder,
  taskSessionHistory,
  taskSurfaceLaunches,
} from "./task-launches";

const qaRejected = { qaReport: { present: true, verdict: "rejected" } };

describe("definition display fields", () => {
  test("action surfaces keep task-level actions out of the Kanban card", () => {
    const task = createTaskCardFixture({ status: "closed" });
    expect(resolveTaskCardActions(task, { surface: "kanban" }).allActions).not.toContain(
      "remove_worktree",
    );
    expect(resolveTaskCardActions(task, { surface: "details" }).allActions).toContain(
      "remove_worktree",
    );
  });

  test("the Studio label replaces only the base action label", () => {
    const ready = createTaskCardFixture({ status: "ready_for_dev" });
    expect(taskActionLabel("build_start", ready)).toBe("Start Builder");
    expect(taskActionLabel("build_start", ready, { surface: "studio" })).toBe(
      "Start Implementation",
    );
    const rejected = createTaskCardFixture({
      status: "in_progress",
      artifactSummary: { ...ready.artifactSummary, ...qaRejected },
    });
    expect(taskActionLabel("build_start", rejected, { surface: "studio" })).toBe(
      "Address QA Feedbacks",
    );
  });

  test("view targets and the approval action resolve from the definition", () => {
    const closed = createTaskCardFixture({ status: "closed" });
    expect(resolveWorkflowAction(closed, "remove_worktree")).toEqual({
      kind: "view",
      target: "worktree_cleanup",
    });
    const review = createTaskCardFixture({ status: "human_review" });
    expect(resolveWorkflowAction(review, "human_approve")).toEqual({ kind: "approval" });
    expect(resolveWorkflowAction(review, "human_request_changes")).toEqual({
      kind: "event",
      eventId: "human-request-changes",
      effects: [],
      launchActionIds: ["build_after_human_request_changes"],
      collectsFeedback: true,
    });
    expect(resolveWorkflowAction(review, "reset_implementation")).toEqual({
      kind: "event",
      eventId: "reset-implementation",
      effects: ["worktree.reset"],
      launchActionIds: [],
      collectsFeedback: false,
    });
    expect(review.taskWorkflow.approvalAvailable(review)).toBe(true);
    expect(closed.taskWorkflow.approvalAvailable(closed)).toBe(false);
  });

  test("launch order rules match the pull request presence", () => {
    const withoutPullRequest = createTaskCardFixture({ status: "human_review" });
    expect(taskLaunchOrder(withoutPullRequest)[0]).toBe("build_pull_request_generation");
    const withPullRequest = createTaskCardFixture({
      status: "human_review",
      pullRequest: {
        providerId: "github",
        number: 1,
        url: "https://example.test/pull/1",
        state: "open",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(taskLaunchOrder(withPullRequest)[0]).toBe("build_after_human_request_changes");
    expect(taskLaunchOrder(createTaskCardFixture({ status: "open" }))).toEqual([]);
  });

  test("surface launches need an available owning step", () => {
    const building = createTaskCardFixture({ status: "in_progress" });
    expect(taskSurfaceLaunches(building, "git_conflict").map(({ id }) => id)).toEqual([
      "build_rebase_conflict_resolution",
    ]);
    expect(
      taskSurfaceLaunches(createTaskCardFixture({ status: "closed" }), "git_conflict"),
    ).toEqual([]);
  });

  test("session history and role panels use the declared defaults", () => {
    expect(taskSessionHistory(createTaskCardFixture({ status: "blocked" }))).toEqual({
      roles: ["build"],
      latest: true,
    });
    expect(taskSessionHistory(createTaskCardFixture({ status: "spec_ready" }))).toEqual({
      roles: ["spec"],
      latest: false,
    });
    const workflow = createTaskCardFixture().taskWorkflow;
    expect(roleDefaultPanel("build", workflow)).toBe("diffs");
    expect(roleDefaultPanel("planner", workflow)).toBe("document");
    expect(roleFocusArtifact("planner", workflow)).toBe("plan");
  });
});

describe("display references", () => {
  const invalid = (change: (definition: ReturnType<typeof reviewTaskDefinition>) => void) => {
    const definition = workflowDefinitionSchema.parse(reviewTaskDefinition());
    change(definition);
    return () => createWorkflow(definition);
  };

  test("reject unknown references and a view action with a step and a target", () => {
    expect(
      invalid((definition) => {
        definition.defaultIssueType = "task";
      }),
    ).toThrow('Unknown issueTypes ID "task"');
    expect(
      invalid((definition) => {
        definition.states[0]!.historyRoles = ["missing"];
      }),
    ).toThrow('Unknown roles ID "missing"');
    expect(
      invalid((definition) => {
        definition.launchOrder = [{ when: true, order: ["missing"] }];
      }),
    ).toThrow('Unknown launch actions ID "missing"');
    expect(
      invalid((definition) => {
        definition.actions.push({
          id: "open_editor",
          kind: "view",
          label: "Open editor",
          stepId: "edit",
          target: "task_details",
          availableWhen: true,
        });
      }),
    ).toThrow("has a step and a target");
  });
});
