import { describe, expect, test } from "bun:test";
import { isKanbanForegroundLoading } from "./use-kanban-page-models";

describe("isKanbanForegroundLoading", () => {
  test("keeps the initial empty-board load as foreground loading", () => {
    expect(
      isKanbanForegroundLoading({
        hasActiveRepo: true,
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
        hasActiveRepo: true,
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
        hasActiveRepo: true,
        isForegroundLoadingTasks: true,
        isSettingsPending: false,
        doneVisibleDays: 1,
        isKanbanPending: false,
      }),
    ).toBe(true);
  });
});
