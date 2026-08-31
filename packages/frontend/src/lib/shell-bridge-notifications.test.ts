import { describe, expect, test } from "bun:test";
import type { NotificationOccurrence } from "@openducktor/contracts";
import { createUnavailableShellBridge } from "./shell-bridge";

const occurrence: NotificationOccurrence = {
  occurrenceId: "workflow.closed:/repo:task-1:event-1",
  kind: "workflow.closed",
  repoPath: "/repo",
  repositoryLabel: "Repo",
  task: { id: "task-1", title: "Build notifications" },
  status: "Task moved to Closed.",
  navigationTarget: { type: "kanban_task", repoPath: "/repo", taskId: "task-1" },
};

describe("unavailable shell notification bridge", () => {
  test("reports unsupported instead of claiming OS delivery", async () => {
    const notifications = createUnavailableShellBridge().notifications;

    expect(await notifications.getCapability()).toEqual({
      platform: "unavailable",
      supported: false,
      permission: "not_applicable",
      canGuaranteeSilent: false,
    });
    expect(
      await notifications.showOsNotification({
        occurrenceId: "workflow.closed:/repo:task-1:event-1",
        title: "Task Closed - task-1",
        body: "Repo - Build notifications",
        silent: true,
        navigationTarget: { type: "kanban_task", repoPath: "/repo", taskId: "task-1" },
      }),
    ).toEqual({
      status: "unsupported",
      message: "OS notifications are unavailable because the OpenDucktor shell is not configured.",
    });
  });

  test("fails when event transport is used before shell configuration", () => {
    const notifications = createUnavailableShellBridge().notifications;
    const expected = "OpenDucktor shell bridge is not configured.";

    expect(() => notifications.publishOccurrence(occurrence)).toThrow(expected);
    expect(() => notifications.subscribeOccurrences(() => {})).toThrow(expected);
    expect(() => notifications.subscribeClicks(() => {})).toThrow(expected);
  });
});
