import { describe, expect, test } from "bun:test";
import { externalTaskSyncEventSchema } from "./external-task-sync-schemas";

describe("external-task-sync-schemas", () => {
  test("parses external task created sync events", () => {
    const parsed = externalTaskSyncEventSchema.parse({
      eventId: "event-1",
      kind: "external_task_created",
      repoPath: "/repo",
      taskId: "task-7",
      emittedAt: "2026-04-10T13:00:00.000Z",
    });

    expect(parsed.kind).toBe("external_task_created");
    expect(parsed.repoPath).toBe("/repo");
    expect(parsed.taskId).toBe("task-7");
  });
});
