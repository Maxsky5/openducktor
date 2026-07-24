import { describe, expect, test } from "bun:test";
import {
  externalTaskSyncEventSchema,
  taskChangeSetSchema,
  taskEventStreamAcknowledgeSchema,
  taskEventStreamFrameSchema,
  taskEventStreamSubscribeSchema,
  tasksUpdatedEventSchema,
} from "./external-task-sync-schemas";

describe("external-task-sync-schemas", () => {
  test("parses external task created sync events", () => {
    const eventId = "event-µ-1";
    const repoPath = "/repo/naïve";
    const taskId = "task-α";
    const parsed = externalTaskSyncEventSchema.parse({
      eventId,
      kind: "external_task_created",
      repoPath,
      taskId,
      emittedAt: "2026-04-10T13:00:00.000Z",
    });

    expect(parsed.kind).toBe("external_task_created");
    expect(parsed.eventId).toBe(eventId);
    expect(parsed.repoPath).toBe(repoPath);
    if (parsed.kind === "external_task_created") {
      expect(parsed.taskId).toBe(taskId);
    }
  });

  test("parses batched task update sync events", () => {
    const parsed = externalTaskSyncEventSchema.parse({
      eventId: "event-2",
      kind: "tasks_updated",
      repoPath: "/repo",
      taskIds: ["task-7", "task-8"],
      removedTaskIds: ["task-7"],
      emittedAt: "2026-04-10T13:05:00.000Z",
    });

    expect(parsed.kind).toBe("tasks_updated");
    expect(parsed.repoPath).toBe("/repo");
    if (parsed.kind === "tasks_updated") {
      expect(parsed.taskIds).toEqual(["task-7", "task-8"]);
      expect(parsed.removedTaskIds).toEqual(["task-7"]);
    }
  });

  test("rejects task event values with surrounding whitespace", () => {
    const validEvent = {
      eventId: "event-1",
      kind: "external_task_created" as const,
      repoPath: "/repo",
      taskId: "task-7",
      emittedAt: "2026-04-10T13:00:00.000Z",
    };

    for (const invalidEvent of [
      { ...validEvent, eventId: " event-1" },
      { ...validEvent, repoPath: "/repo " },
      { ...validEvent, taskId: " task-7 " },
      {
        eventId: "event-2",
        kind: "tasks_updated" as const,
        repoPath: "/repo",
        taskIds: ["task-7 "],
        removedTaskIds: [],
        emittedAt: "2026-04-10T13:05:00.000Z",
      },
    ]) {
      const parsed = externalTaskSyncEventSchema.safeParse(invalidEvent);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.map((issue) => issue.message)).toContain(
          "Task event values must not include leading or trailing whitespace.",
        );
      }
    }
  });

  test("rejects empty, whitespace, and duplicate task change IDs", () => {
    const validChangeSet = {
      taskIds: ["task-7"],
      removedTaskIds: [],
    };

    for (const invalidChangeSet of [
      { ...validChangeSet, taskIds: [] },
      { ...validChangeSet, taskIds: [" "] },
      { ...validChangeSet, taskIds: [" task-7 "] },
      { ...validChangeSet, taskIds: ["task-7", "task-7"] },
      { ...validChangeSet, removedTaskIds: [" "] },
      { ...validChangeSet, removedTaskIds: ["task-7 "] },
      { ...validChangeSet, removedTaskIds: ["task-7", "task-7"] },
    ]) {
      expect(taskChangeSetSchema.safeParse(invalidChangeSet).success).toBe(false);
      expect(
        tasksUpdatedEventSchema.safeParse({
          eventId: "event-3",
          kind: "tasks_updated",
          repoPath: "/repo",
          ...invalidChangeSet,
          emittedAt: "2026-04-10T13:10:00.000Z",
        }).success,
      ).toBe(false);
    }
  });

  test("rejects removed task IDs that are not part of the update", () => {
    const invalidChangeSet = {
      taskIds: ["task-7"],
      removedTaskIds: ["task-8"],
    };

    expect(taskChangeSetSchema.safeParse(invalidChangeSet).success).toBe(false);
    expect(
      tasksUpdatedEventSchema.safeParse({
        eventId: "event-4",
        kind: "tasks_updated",
        repoPath: "/repo",
        ...invalidChangeSet,
        emittedAt: "2026-04-10T13:15:00.000Z",
      }).success,
    ).toBe(false);
  });
  test("parses strict task event stream cursors, frames, and checkpoints", () => {
    const cursor = { epoch: "be8e34ef-2e0e-4e9a-a63f-72719f95c7b7", sequence: 4 };
    expect(
      taskEventStreamFrameSchema.parse({
        type: "change",
        cursor,
        event: {
          eventId: "event-5",
          kind: "external_task_created",
          repoPath: "/repo",
          taskId: "task-7",
          emittedAt: "2026-04-10T13:20:00.000Z",
        },
      }),
    ).toMatchObject({ type: "change", cursor });
    expect(taskEventStreamSubscribeSchema.parse({ cursor: null })).toEqual({ cursor: null });
    expect(
      taskEventStreamAcknowledgeSchema.parse({
        subscriptionId: "78a3be5c-f828-4bb7-b219-390b7306bc07",
        cursor,
      }),
    ).toMatchObject({ cursor });
  });
  test("rejects malformed task event stream protocol payloads", () => {
    expect(
      taskEventStreamFrameSchema.safeParse({
        type: "snapshot_required",
        cursor: { epoch: "not-a-uuid", sequence: -1 },
        reason: "initial",
      }).success,
    ).toBe(false);
    expect(taskEventStreamSubscribeSchema.safeParse({ cursor: null, extra: true }).success).toBe(
      false,
    );
    expect(
      taskEventStreamAcknowledgeSchema.safeParse({
        subscriptionId: "not-a-uuid",
        cursor: { epoch: "be8e34ef-2e0e-4e9a-a63f-72719f95c7b7", sequence: 1.5 },
      }).success,
    ).toBe(false);
  });
});
