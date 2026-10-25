import { describe, expect, test } from "bun:test";
import { resolveTaskBoardState, taskBoardView } from "./task-board-state";

const reads = {
  settingsError: null,
  taskReadError: null,
  taskCount: 3,
  isLoadingTasks: false,
};

describe("resolveTaskBoardState", () => {
  test("stops the board on any settings read failure, as on desktop", () => {
    expect(
      resolveTaskBoardState({ ...reads, settingsError: new Error("Host unreachable") }),
    ).toEqual({
      status: "error",
      title: "Kanban settings could not load",
      message: "Host unreachable",
    });
  });

  test("shows a task read failure only when no task loaded", () => {
    const failed = { ...reads, taskReadError: new Error("Task store is locked") };

    expect(resolveTaskBoardState({ ...failed, taskCount: 0 }).status).toBe("error");
    expect(resolveTaskBoardState({ ...failed, taskCount: 2 })).toEqual({ status: "ready" });
  });

  test("keeps the cards during a foreground load", () => {
    const loading = { ...reads, isLoadingTasks: true };

    expect(resolveTaskBoardState({ ...loading, taskCount: 0 })).toEqual({ status: "loading" });
    expect(resolveTaskBoardState({ ...loading, taskCount: 2 })).toEqual({ status: "ready" });
  });
});

describe("taskBoardView", () => {
  const ready = {
    state: { status: "ready" } as const,
    hostUnavailable: false,
    taskCount: 3,
    filterActive: false,
    matchingCount: 3,
    columnCount: 2,
  };

  test("shows the lanes of a ready board, also while the host is unavailable", () => {
    expect(taskBoardView(ready)).toEqual({ kind: "board" });
    expect(taskBoardView({ ...ready, hostUnavailable: true })).toEqual({ kind: "board" });
  });

  test("shows the connection state for a board that has not loaded while the host is unavailable", () => {
    expect(
      taskBoardView({ ...ready, state: { status: "loading" }, hostUnavailable: true }),
    ).toEqual({
      kind: "host_unavailable",
    });
  });

  test("shows the load and the read failure of the board", () => {
    expect(taskBoardView({ ...ready, state: { status: "loading" } })).toEqual({ kind: "loading" });
    expect(
      taskBoardView({ ...ready, state: { status: "error", title: "Failed", message: "Retry." } }),
    ).toEqual({ kind: "error", title: "Failed", message: "Retry." });
  });

  test("says when the workspace has no task, a filter keeps none, or every lane is hidden", () => {
    expect(taskBoardView({ ...ready, taskCount: 0 })).toEqual({ kind: "no_tasks" });
    expect(taskBoardView({ ...ready, filterActive: true, matchingCount: 0 })).toEqual({
      kind: "no_results",
    });
    expect(taskBoardView({ ...ready, columnCount: 0 })).toEqual({ kind: "no_lanes" });
  });
});
