import { describe, expect, test } from "bun:test";
import { mapToKanbanColumns, type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import { createTaskCardFixture } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import { buildBoardColumns, columnChoiceLabel, resolveSelectedColumnId } from "./board-columns";

const task = (id: string, status: TaskCard["status"]): TaskCard =>
  createTaskCardFixture({ id, title: id, status });

const columnsOf = (tasks: TaskCard[]) => mapToKanbanColumns(tasks);

describe("buildBoardColumns", () => {
  test("keeps the desktop columns and titles in order", () => {
    const columns = buildBoardColumns({
      columns: columnsOf([task("A", "in_progress")]),
      emptyColumnDisplay: "show",
      doneVisibleDays: 1,
      filterActive: false,
    });
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
    expect(columns.find((column) => column.id === "in_progress")?.emptyMessage).toBeNull();
    expect(columns.find((column) => column.id === "blocked")?.emptyMessage).toBeNull();
  });

  test("explains an empty Done column with the host Done visibility", () => {
    const shown = buildBoardColumns({
      columns: columnsOf([]),
      emptyColumnDisplay: "show",
      doneVisibleDays: 3,
      filterActive: false,
    });
    expect(shown.find((column) => column.id === "closed")?.emptyMessage).toBe(
      "Done tasks show here for 3 days after they close.",
    );
    const hidden = buildBoardColumns({
      columns: columnsOf([]),
      emptyColumnDisplay: "show",
      doneVisibleDays: 0,
      filterActive: false,
    });
    expect(hidden.find((column) => column.id === "closed")?.emptyMessage).toBe(
      "The host Kanban setting hides Done tasks. Change it in the desktop or web app.",
    );
  });

  test("shows the Done tasks that the host returns", () => {
    const columns = buildBoardColumns({
      columns: columnsOf([task("D", "closed")]),
      emptyColumnDisplay: "hidden",
      doneVisibleDays: 1,
      filterActive: false,
    });
    expect(columns.map((column) => column.id)).toEqual(["closed"]);
    expect(columns[0]?.tasks.map((entry) => entry.id)).toEqual(["D"]);
  });

  test("hides or collapses empty columns as the host setting says", () => {
    const tasks = [task("A", "open")];
    expect(
      buildBoardColumns({
        columns: columnsOf(tasks),
        emptyColumnDisplay: "hidden",
        doneVisibleDays: 1,
        filterActive: false,
      }).map((column) => column.id),
    ).toEqual(["open"]);
    const collapsed = buildBoardColumns({
      columns: columnsOf(tasks),
      emptyColumnDisplay: "collapsed",
      doneVisibleDays: 1,
      filterActive: false,
    });
    expect(collapsed.find((column) => column.id === "open")?.collapsed).toBe(false);
    expect(collapsed.find((column) => column.id === "closed")?.collapsed).toBe(true);
  });

  test("says that the filters hide the tasks of an empty column", () => {
    const columns = buildBoardColumns({
      columns: columnsOf([]),
      emptyColumnDisplay: "show",
      doneVisibleDays: 1,
      filterActive: true,
    });
    expect(columns[0]?.emptyMessage).toBe("No task in this lane matches the search and filters.");
  });
});

describe("resolveSelectedColumnId", () => {
  test("keeps a visible choice and falls back to the first column otherwise", () => {
    const columns = buildBoardColumns({
      columns: columnsOf([task("A", "open"), task("B", "blocked")]),
      emptyColumnDisplay: "hidden",
      doneVisibleDays: 1,
      filterActive: false,
    });
    expect(resolveSelectedColumnId(columns, "blocked")).toBe("blocked");
    expect(resolveSelectedColumnId(columns, "ai_review")).toBe("open");
    expect(resolveSelectedColumnId([], "open")).toBeNull();
  });
});

describe("columnChoiceLabel", () => {
  test("names the column and its task count", () => {
    expect(columnChoiceLabel({ title: "In Progress", tasks: [task("A", "in_progress")] })).toBe(
      "In Progress, 1 task",
    );
    expect(columnChoiceLabel({ title: "Done", tasks: [] })).toBe("Done, 0 tasks");
  });
});
