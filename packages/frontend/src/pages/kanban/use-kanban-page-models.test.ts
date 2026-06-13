import { describe, expect, mock, test } from "bun:test";
import { isKanbanForegroundLoading, resetTaskAndReloadSessions } from "./use-kanban-page-models";

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

describe("resetTaskAndReloadSessions", () => {
  test("removes every local session for a fully reset task", async () => {
    const resetTask = mock(async () => {});
    const removeAgentSessions = mock(async () => {});
    const loadAgentSessions = mock(async () => {});

    await resetTaskAndReloadSessions({
      taskId: "TASK-123",
      resetTask,
      removeAgentSessions,
      loadAgentSessions,
    });

    expect(resetTask).toHaveBeenCalledWith("TASK-123");
    expect(removeAgentSessions).toHaveBeenCalledWith({ taskId: "TASK-123" });
    expect(loadAgentSessions).toHaveBeenCalledWith("TASK-123");
  });

  test("reports session refresh failures after local cleanup", async () => {
    const error = new Error("session refresh failed");
    const resetTask = mock(async () => {});
    const removeAgentSessions = mock(async () => {});
    const loadAgentSessions = mock(async () => {
      throw error;
    });
    const onSessionRefreshError = mock(() => {});

    await expect(
      resetTaskAndReloadSessions({
        taskId: "TASK-123",
        resetTask,
        removeAgentSessions,
        loadAgentSessions,
        onSessionRefreshError,
      }),
    ).rejects.toThrow("session refresh failed");

    expect(removeAgentSessions).toHaveBeenCalledWith({ taskId: "TASK-123" });
    expect(onSessionRefreshError).toHaveBeenCalledWith(error);
  });
});
