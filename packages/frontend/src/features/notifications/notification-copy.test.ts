import { describe, expect, test } from "bun:test";
import type { NotificationOccurrence } from "@openducktor/contracts";
import { buildNotificationCopy } from "./notification-copy";

describe("notification copy", () => {
  test("keeps event identity and Task ID at the start", () => {
    const occurrence: NotificationOccurrence = {
      occurrenceId: "workflow.blocked:/repo:task-1:event-1",
      kind: "workflow.blocked",
      repoPath: "/repo",
      repositoryLabel: "Repo",
      task: { id: "task-1", title: "Build notifications" },
      role: "build",
      sessionLabel: "Builder session",
      status: "Task Blocked and needs attention.",
      navigationTarget: {
        type: "agent_studio_task",
        repoPath: "/repo",
        taskId: "task-1",
        preferredRole: "build",
      },
    };

    expect(buildNotificationCopy(occurrence)).toEqual({
      title: "Task Blocked - task-1",
      body: "Repo - Build notifications - Builder - Builder session - Task Blocked and needs attention.",
    });
  });
});
