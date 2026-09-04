import { describe, expect, test } from "bun:test";
import { getTaskReadLoadingState } from "./task-read-loading-state";

const getLoadingState = (overrides: Partial<Parameters<typeof getTaskReadLoadingState>[0]> = {}) =>
  getTaskReadLoadingState({
    activeRepoPath: "/repo",
    isManualLoadingTasks: false,
    isSettingsLoadingForActiveRepo: false,
    isTaskQueryLoadingForActiveRepo: false,
    isTaskQueryFetchingForActiveRepo: false,
    isTaskQuerySuccessForActiveRepo: true,
    ...overrides,
  });

describe("task read loading state", () => {
  test("marks only an idle successful task query as current", () => {
    expect(getLoadingState()).toMatchObject({ tasksAreCurrent: true });
    expect(getLoadingState({ isTaskQueryFetchingForActiveRepo: true })).toMatchObject({
      tasksAreCurrent: false,
    });
    expect(getLoadingState({ isTaskQuerySuccessForActiveRepo: false })).toMatchObject({
      tasksAreCurrent: false,
    });
  });

  test("treats a manual refresh as foreground loading", () => {
    expect(getLoadingState({ isManualLoadingTasks: true })).toEqual({
      tasksAreCurrent: false,
      isForegroundLoadingTasks: true,
      isRefreshingTasksInBackground: false,
      isLoadingTasks: true,
    });
  });

  test("treats pending settings as foreground loading", () => {
    expect(getLoadingState({ isSettingsLoadingForActiveRepo: true })).toEqual({
      tasksAreCurrent: false,
      isForegroundLoadingTasks: true,
      isRefreshingTasksInBackground: false,
      isLoadingTasks: true,
    });
  });

  test("treats an initial active task query as foreground loading", () => {
    expect(getLoadingState({ isTaskQueryLoadingForActiveRepo: true })).toEqual({
      tasksAreCurrent: false,
      isForegroundLoadingTasks: true,
      isRefreshingTasksInBackground: false,
      isLoadingTasks: true,
    });
  });

  test("treats active query fetching without a foreground condition as background refreshing", () => {
    expect(getLoadingState({ isTaskQueryFetchingForActiveRepo: true })).toEqual({
      tasksAreCurrent: false,
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
        tasksAreCurrent: false,
        isForegroundLoadingTasks: true,
        isRefreshingTasksInBackground: false,
        isLoadingTasks: true,
      });
    }
  });

  test("reports neither loading state while idle or disabled without an active repo", () => {
    expect(getLoadingState()).toEqual({
      tasksAreCurrent: true,
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
      tasksAreCurrent: false,
      isForegroundLoadingTasks: false,
      isRefreshingTasksInBackground: false,
      isLoadingTasks: false,
    });
  });
});
