import { describe, expect, test } from "bun:test";
import { createUnavailableShellBridge } from "./shell-bridge";

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
});
