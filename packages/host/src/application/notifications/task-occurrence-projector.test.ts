import { describe, expect, test } from "bun:test";
import { builtinTaskWorkflows, reviewTaskWorkflows } from "../../test-support/task-workflows";
import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import { createTaskOccurrenceProjector } from "./task-occurrence-projector";

const event = (
  eventId: string,
  status: string,
  previousStatus: string = "open",
): Extract<ExternalTaskSyncEvent, { kind: "tasks_updated" }> => ({
  eventId,
  kind: "tasks_updated",
  boardChanges: null,
  repoPath: "/repo",
  taskIds: ["task-1"],
  removedTaskIds: [],
  statusChanges: [{ previousStatus, task: { id: "task-1", title: "Task", status } }],
  taskSnapshots: [{ id: "task-1", title: "Task", status }],
  emittedAt: "2026-08-31T10:00:00.000Z",
});

describe("task occurrence projector", () => {
  test.each([
    ["in_progress", "build"],
    ["blocked", "build"],
    ["blocked", "qa"],
    ["ai_review", "qa"],
  ] as const)("routes Human Review from %s to its source role %s", (previousStatus, sourceRole) => {
    const projector = createTaskOccurrenceProjector({
      taskWorkflows: builtinTaskWorkflows,
      repoPath: "/repo",
      repositoryLabel: "Repo",
    });
    const update = event("review", "human_review", previousStatus);
    update.statusChanges[0]!.sourceRole = sourceRole;
    expect(projector.projectChange(update).occurrences).toMatchObject([
      {
        role: sourceRole,
        navigationTarget: {
          type: "agent_studio_task",
          taskId: "task-1",
          preferredRole: sourceRole,
        },
      },
    ]);
  });
  test.each([
    ["spec_ready", "workflow.spec_ready", "spec"],
    ["ready_for_dev", "workflow.ready_for_dev", "planner"],
    ["in_progress", "workflow.in_progress", "build"],
    ["blocked", "workflow.blocked", "build"],
    ["ai_review", "workflow.ai_review", "build"],
    ["human_review", "workflow.human_review", "qa"],
  ] as const)("projects a live transition to %s", (status, kind, preferredRole) => {
    const projector = createTaskOccurrenceProjector({
      taskWorkflows: builtinTaskWorkflows,
      repoPath: "/repo",
      repositoryLabel: "Repo",
    });

    expect(projector.projectChange(event(`event-${status}`, status)).occurrences).toMatchObject([
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
      taskWorkflows: builtinTaskWorkflows,
      repoPath: "/repo",
      repositoryLabel: "Repo",
    });

    expect(projector.projectChange(event("event-closed", "closed")).occurrences).toMatchObject([
      {
        kind: "workflow.closed",
        navigationTarget: { type: "kanban_task", repoPath: "/repo", taskId: "task-1" },
      },
    ]);
  });

  test("does not notify for unchanged status, metadata-only updates, or Open", () => {
    const projector = createTaskOccurrenceProjector({
      taskWorkflows: builtinTaskWorkflows,
      repoPath: "/repo",
      repositoryLabel: "Repo",
    });
    expect(projector.projectChange(event("event-same", "blocked", "blocked")).occurrences).toEqual(
      [],
    );
    expect(projector.projectChange(event("event-open", "open")).occurrences).toEqual([]);

    const newTaskProjector = createTaskOccurrenceProjector({
      taskWorkflows: builtinTaskWorkflows,
      repoPath: "/repo",
      repositoryLabel: "Repo",
    });
    expect(
      newTaskProjector.projectChange({
        ...event("event-metadata", "spec_ready"),
        statusChanges: [],
      }).occurrences,
    ).toEqual([]);
  });
});

test("keeps repeated destinations within one mutation distinct and suppresses replay", () => {
  const projector = createTaskOccurrenceProjector({
    taskWorkflows: builtinTaskWorkflows,
    repoPath: "/repo",
    repositoryLabel: "Repo",
  });
  const update = event("multi-change", "blocked");
  update.statusChanges = [
    { previousStatus: "in_progress", task: { id: "task-1", title: "Task", status: "blocked" } },
    { previousStatus: "blocked", task: { id: "task-1", title: "Task", status: "in_progress" } },
    { previousStatus: "in_progress", task: { id: "task-1", title: "Task", status: "blocked" } },
  ];
  const { accepted, occurrences } = projector.projectChange(update);
  expect(accepted).toBe(true);
  expect(occurrences.map((entry) => entry.kind)).toEqual([
    "workflow.blocked",
    "workflow.in_progress",
    "workflow.blocked",
  ]);
  expect(new Set(occurrences.map((entry) => entry.occurrenceId)).size).toBe(3);
  expect(projector.projectChange(update)).toEqual({ accepted: false, occurrences: [] });
});

test("accepts a silent event once so callers can skip its repeated ownership work", () => {
  const projector = createTaskOccurrenceProjector({
    taskWorkflows: builtinTaskWorkflows,
    repoPath: "/repo",
    repositoryLabel: "Repo",
  });
  const update = { ...event("metadata", "open"), statusChanges: [] };
  expect(projector.projectChange(update)).toEqual({ accepted: true, occurrences: [] });
  expect(projector.projectChange(update)).toEqual({ accepted: false, occurrences: [] });
});

test("projects the state notifications of a custom workflow", () => {
  const projector = createTaskOccurrenceProjector({
    taskWorkflows: reviewTaskWorkflows,
    repoPath: "/repo",
    repositoryLabel: "Repo",
  });

  expect(
    projector.projectChange(event("review", "reviewing", "writing")).occurrences,
  ).toMatchObject([
    {
      kind: "workflow.reviewing",
      role: "editor",
      status: "Task moved to Reviewing.",
      navigationTarget: { type: "agent_studio_task", taskId: "task-1", preferredRole: "editor" },
    },
  ]);
  expect(
    projector.projectChange(event("publish", "published", "approval")).occurrences,
  ).toMatchObject([
    { kind: "workflow.published", navigationTarget: { type: "kanban_task", taskId: "task-1" } },
  ]);
  expect(projector.projectChange(event("shelve", "shelved", "backlog")).occurrences).toEqual([]);
});
