import { describe, expect, test } from "bun:test";
import type { ExternalTaskSyncEvent, TaskCard, TaskStatus } from "@openducktor/contracts";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import { createTaskOccurrenceProjector } from "./task-occurrence-projector";

const task = (status: TaskStatus): TaskCard =>
  createTaskCardFixture({ id: "task-1", title: "Build notifications", status });

const event = (
  eventId: string,
  status: TaskStatus,
): Extract<ExternalTaskSyncEvent, { kind: "tasks_updated" }> => ({
  eventId,
  kind: "tasks_updated",
  repoPath: "/repo",
  taskIds: ["task-1"],
  removedTaskIds: [],
  taskSnapshots: [{ id: "task-1", title: "Task", status }],
  emittedAt: "2026-08-31T10:00:00.000Z",
});

describe("task occurrence projector", () => {
  test.each([
    ["spec_ready", "workflow.spec_ready", "spec"],
    ["ready_for_dev", "workflow.ready_for_dev", "planner"],
    ["in_progress", "workflow.in_progress", "build"],
    ["blocked", "workflow.blocked", "build"],
    ["ai_review", "workflow.ai_review", "build"],
    ["human_review", "workflow.human_review", "qa"],
  ] as const)("projects a live transition to %s", (status, kind, preferredRole) => {
    const projector = createTaskOccurrenceProjector({
      repoPath: "/repo",
      repositoryLabel: "Repo",
    });
    projector.replaceBaseline([task("open")]);

    expect(projector.projectChange(event(`event-${status}`, status))).toMatchObject([
      {
        kind,
        occurrenceId: `${kind}:/repo:task-1:event-${status}`,
        navigationTarget: {
          type: "agent_studio_task",
          repoPath: "/repo",
          taskId: "task-1",
          preferredRole,
        },
      },
    ]);
  });

  test("routes Closed to the exact Kanban details sheet", () => {
    const projector = createTaskOccurrenceProjector({
      repoPath: "/repo",
      repositoryLabel: "Repo",
    });
    projector.replaceBaseline([task("human_review")]);

    expect(projector.projectChange(event("event-closed", "closed"))).toMatchObject([
      {
        kind: "workflow.closed",
        navigationTarget: { type: "kanban_task", repoPath: "/repo", taskId: "task-1" },
      },
    ]);
  });

  test("does not notify for initial tasks, snapshot replacement, unchanged status, or Open", () => {
    const projector = createTaskOccurrenceProjector({
      repoPath: "/repo",
      repositoryLabel: "Repo",
    });
    projector.replaceBaseline([task("blocked")]);
    projector.replaceBaseline([task("blocked")]);
    expect(projector.projectChange(event("event-same", "blocked"))).toEqual([]);
    expect(projector.projectChange(event("event-open", "open"))).toEqual([]);

    const newTaskProjector = createTaskOccurrenceProjector({
      repoPath: "/repo",
      repositoryLabel: "Repo",
    });
    expect(newTaskProjector.projectChange(event("event-created", "spec_ready"))).toEqual([]);
  });
});
