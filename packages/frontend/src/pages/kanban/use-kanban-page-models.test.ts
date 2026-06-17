import { describe, expect, mock, test } from "bun:test";
import {
  isKanbanForegroundLoading,
  resetTaskAndRefreshTaskSessions,
} from "./use-kanban-page-models";

describe("isKanbanForegroundLoading", () => {
  test("keeps the initial empty-board load as foreground loading", () => {
    expect(
      isKanbanForegroundLoading({
        hasActiveWorkspace: true,
        isForegroundLoadingTasks: false,
        isSettingsPending: false,
        doneVisibleDays: 1,
        isKanbanPending: true,
      }),
    ).toBe(true);
  });

  test("ignores background kanban refetches after the board already has data", () => {
    expect(
      isKanbanForegroundLoading({
        hasActiveWorkspace: true,
        isForegroundLoadingTasks: false,
        isSettingsPending: false,
        doneVisibleDays: 1,
        isKanbanPending: false,
      }),
    ).toBe(false);
  });

  test("keeps manual task refreshes as foreground loading", () => {
    expect(
      isKanbanForegroundLoading({
        hasActiveWorkspace: true,
        isForegroundLoadingTasks: true,
        isSettingsPending: false,
        doneVisibleDays: 1,
        isKanbanPending: false,
      }),
    ).toBe(true);
  });
});

describe("resetTaskAndRefreshTaskSessions", () => {
  test("refreshes the task session read model after resetting the task", async () => {
    const resetTask = mock(async () => {});
    const refreshTaskSessions = mock(async () => {});

    await resetTaskAndRefreshTaskSessions({
      taskId: "TASK-123",
      resetTask,
      refreshTaskSessions,
    });

    expect(resetTask).toHaveBeenCalledWith("TASK-123");
    expect(refreshTaskSessions).toHaveBeenCalledWith("TASK-123");
  });

  test("reports task session read-model refresh failures", async () => {
    const error = new Error("session refresh failed");
    const resetTask = mock(async () => {});
    const refreshTaskSessions = mock(async () => {
      throw error;
    });
    const onSessionRefreshError = mock(() => {});

    await expect(
      resetTaskAndRefreshTaskSessions({
        taskId: "TASK-123",
        resetTask,
        refreshTaskSessions,
        onSessionRefreshError,
      }),
    ).rejects.toThrow("session refresh failed");

    expect(refreshTaskSessions).toHaveBeenCalledWith("TASK-123");
    expect(onSessionRefreshError).toHaveBeenCalledWith(error);
  });
});
