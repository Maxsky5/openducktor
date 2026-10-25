import { describe, expect, test } from "bun:test";
import type { TaskStatus } from "@openducktor/contracts";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import type { KanbanTaskSession } from "./kanban-task-activity";
import { buildKanbanBoardColumns } from "./use-kanban-board-columns";

const task = (id: string, status: TaskStatus) => createTaskCardFixture({ id, status });

const session = (activityState: KanbanTaskSession["activityState"]): KanbanTaskSession => ({
  externalSessionId: `session-${activityState}`,
  runtimeKind: "opencode",
  workingDirectory: "/repo",
  role: "build",
  activityState,
});

describe("buildKanbanBoardColumns", () => {
  test("puts each task in the column of its status, in board order", () => {
    const { columns } = buildKanbanBoardColumns(
      [task("TASK-1", "closed"), task("TASK-2", "open"), task("TASK-3", "blocked")],
      new Map(),
    );

    expect(columns.map((column) => column.title)).toEqual([
      "Backlog",
      "Spec Ready",
      "Ready for Dev",
      "In Progress",
      "Blocked / Needs Input",
      "AI Review",
      "Human Review",
      "Done",
    ]);
    expect(columns.map((column) => column.tasks.map((entry) => entry.id))).toEqual([
      ["TASK-2"],
      [],
      [],
      [],
      ["TASK-3"],
      [],
      [],
      ["TASK-1"],
    ]);
  });

  test("puts tasks that wait for input first, then active tasks, then idle tasks", () => {
    const tasks = [
      task("TASK-IDLE", "in_progress"),
      task("TASK-ACTIVE", "in_progress"),
      task("TASK-WAITING", "in_progress"),
    ];
    const { columns, taskActivityStateByTaskId } = buildKanbanBoardColumns(
      tasks,
      new Map([
        ["TASK-ACTIVE", [session("running")]],
        ["TASK-WAITING", [session("running"), session("waiting_input")]],
      ]),
    );

    const inProgress = columns.find((column) => column.id === "in_progress");
    expect(inProgress?.tasks.map((entry) => entry.id)).toEqual([
      "TASK-WAITING",
      "TASK-ACTIVE",
      "TASK-IDLE",
    ]);
    expect(Object.fromEntries(taskActivityStateByTaskId)).toEqual({
      "TASK-IDLE": "idle",
      "TASK-ACTIVE": "active",
      "TASK-WAITING": "waiting_input",
    });
  });
});
