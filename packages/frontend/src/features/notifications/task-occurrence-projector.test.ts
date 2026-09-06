import { describe, expect, test } from "bun:test";
import type { ExternalTaskSyncEvent, TaskStatus } from "@openducktor/contracts";
import { createTaskOccurrenceProjector } from "./task-occurrence-projector";

const event = (
  eventId: string,
  status: TaskStatus,
  previousStatus: TaskStatus = "open",
): Extract<ExternalTaskSyncEvent, { kind: "tasks_updated" }> => ({
  eventId,
  kind: "tasks_updated",
  repoPath: "/repo",
  taskIds: ["task-1"],
  removedTaskIds: [],
  statusChanges: [{ previousStatus, task: { id: "task-1", title: "Task", status } }],
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

    expect(projector.projectChange(event(`event-${status}`, status))).toMatchObject([
      {
        kind,
        occurrenceId: `${kind}:/repo:task-1:event-${status}:0`,
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

    expect(projector.projectChange(event("event-closed", "closed"))).toMatchObject([
      {
        kind: "workflow.closed",
        navigationTarget: { type: "kanban_task", repoPath: "/repo", taskId: "task-1" },
      },
    ]);
  });

  test("does not notify for unchanged status, metadata-only updates, or Open", () => {
    const projector = createTaskOccurrenceProjector({
      repoPath: "/repo",
      repositoryLabel: "Repo",
    });
    expect(projector.projectChange(event("event-same", "blocked", "blocked"))).toEqual([]);
    expect(projector.projectChange(event("event-open", "open"))).toEqual([]);

    const newTaskProjector = createTaskOccurrenceProjector({
      repoPath: "/repo",
      repositoryLabel: "Repo",
    });
    expect(
      newTaskProjector.projectChange({
        ...event("event-metadata", "spec_ready"),
        statusChanges: [],
      }),
    ).toEqual([]);
  });
});

test("keeps repeated destinations within one mutation distinct and suppresses replay", () => {
  const projector = createTaskOccurrenceProjector({ repoPath: "/repo", repositoryLabel: "Repo" });
  const update = event("multi-change", "blocked");
  update.statusChanges = [
    { previousStatus: "in_progress", task: { id: "task-1", title: "Task", status: "blocked" } },
    { previousStatus: "blocked", task: { id: "task-1", title: "Task", status: "in_progress" } },
    { previousStatus: "in_progress", task: { id: "task-1", title: "Task", status: "blocked" } },
  ];
  const occurrences = projector.projectChange(update);
  expect(occurrences.map((entry) => entry.kind)).toEqual([
    "workflow.blocked",
    "workflow.in_progress",
    "workflow.blocked",
  ]);
  expect(new Set(occurrences.map((entry) => entry.occurrenceId)).size).toBe(3);
  expect(projector.projectChange(update)).toEqual([]);
});
