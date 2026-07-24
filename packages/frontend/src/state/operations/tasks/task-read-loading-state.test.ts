import { describe, expect, test } from "bun:test";
import { getTaskReadLoadingState } from "./task-read-loading-state";

const getLoadingState = (overrides: Partial<Parameters<typeof getTaskReadLoadingState>[0]> = {}) =>
  getTaskReadLoadingState({
    activeRepoPath: "/repo",
    isManualLoadingTasks: false,
    isSettingsLoadingForActiveRepo: false,
    isTaskQueryLoadingForActiveRepo: false,
    isTaskQueryFetchingForActiveRepo: false,
    ...overrides,
  });

describe("task read loading state", () => {
  test("treats a manual refresh as foreground loading", () => {
    expect(getLoadingState({ isManualLoadingTasks: true })).toEqual({
      isForegroundLoadingTasks: true,
      isRefreshingTasksInBackground: false,
      isLoadingTasks: true,
    });
  });

  test("treats pending settings as foreground loading", () => {
    expect(getLoadingState({ isSettingsLoadingForActiveRepo: true })).toEqual({
      isForegroundLoadingTasks: true,
      isRefreshingTasksInBackground: false,
      isLoadingTasks: true,
    });
  });

  test("treats an initial active task query as foreground loading", () => {
    expect(getLoadingState({ isTaskQueryLoadingForActiveRepo: true })).toEqual({
      isForegroundLoadingTasks: true,
      isRefreshingTasksInBackground: false,
      isLoadingTasks: true,
    });
  });

  test("treats active query fetching without a foreground condition as background refreshing", () => {
    expect(getLoadingState({ isTaskQueryFetchingForActiveRepo: true })).toEqual({
      isForegroundLoadingTasks: false,
      isRefreshingTasksInBackground: true,
      isLoadingTasks: false,
    });
  });

  test("does not also report background refreshing when fetching has a foreground condition", () => {
    for (const foregroundCondition of [
      { isManualLoadingTasks: true },
      { isSettingsLoadingForActiveRepo: true },
      { isTaskQueryLoadingForActiveRepo: true },
    ]) {
      expect(
        getLoadingState({ ...foregroundCondition, isTaskQueryFetchingForActiveRepo: true }),
      ).toEqual({
        isForegroundLoadingTasks: true,
        isRefreshingTasksInBackground: false,
        isLoadingTasks: true,
      });
    }
  });

  test("reports neither loading state while idle or disabled without an active repo", () => {
    expect(getLoadingState()).toEqual({
      isForegroundLoadingTasks: false,
      isRefreshingTasksInBackground: false,
      isLoadingTasks: false,
    });
    expect(
      getLoadingState({
        activeRepoPath: null,
        isManualLoadingTasks: true,
        isSettingsLoadingForActiveRepo: true,
        isTaskQueryLoadingForActiveRepo: true,
        isTaskQueryFetchingForActiveRepo: true,
      }),
    ).toEqual({
      isForegroundLoadingTasks: false,
      isRefreshingTasksInBackground: false,
      isLoadingTasks: false,
    });
  });
});
