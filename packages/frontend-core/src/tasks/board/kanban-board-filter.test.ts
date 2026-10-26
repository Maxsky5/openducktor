import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import {
  EMPTY_KANBAN_BOARD_FILTER,
  filterKanbanTasks,
  isKanbanBoardFilterActive,
  kanbanLabelOptions,
  type KanbanBoardFilter,
} from "./kanban-board-filter";

const createTasks = () => [
  createTaskCardFixture({
    id: "openducktor-c99",
    title: "Add search and filters in Kanban board",
    issueType: "feature",
    priority: 2,
    labels: ["ui", "kanban"],
  }),
  createTaskCardFixture({
    id: "openducktor-a12",
    title: "Fix crash on startup",
    issueType: "bug",
    priority: 0,
    labels: ["bug"],
  }),
  createTaskCardFixture({
    id: "openducktor-b34",
    title: "Write release notes",
    issueType: "task",
    priority: 4,
    labels: [],
  }),
];

const matchingIds = (filter: Partial<KanbanBoardFilter>): string[] =>
  filterKanbanTasks(createTasks(), { ...EMPTY_KANBAN_BOARD_FILTER, ...filter }).map(
    (task) => task.id,
  );

describe("filterKanbanTasks", () => {
  test("keeps every task in its input order without search text or selections", () => {
    expect(matchingIds({})).toEqual(["openducktor-c99", "openducktor-a12", "openducktor-b34"]);
    expect(matchingIds({ searchText: "   " })).toHaveLength(3);
  });

  test("matches part of the title, the task ID, or a label without case", () => {
    expect(matchingIds({ searchText: "FILT" })).toEqual(["openducktor-c99"]);
    expect(matchingIds({ searchText: "b34" })).toEqual(["openducktor-b34"]);
    expect(matchingIds({ searchText: "Kanb" })).toEqual(["openducktor-c99"]);
    expect(matchingIds({ searchText: "  crash  " })).toEqual(["openducktor-a12"]);
  });

  test("needs each search word to match a field, in any order", () => {
    expect(matchingIds({ searchText: "kanban ui" })).toEqual(["openducktor-c99"]);
    expect(matchingIds({ searchText: "ui   search" })).toEqual(["openducktor-c99"]);
    expect(matchingIds({ searchText: "kanban crash" })).toEqual([]);
  });

  test("does not match a subsequence that is not part of a field", () => {
    expect(matchingIds({ searchText: "asf" })).toEqual([]);
  });

  test("matches any selected value in a filter and every filter with a selection", () => {
    expect(matchingIds({ labels: ["ui", "bug"] })).toEqual(["openducktor-c99", "openducktor-a12"]);
    expect(matchingIds({ issueTypes: ["bug", "task"] })).toEqual([
      "openducktor-a12",
      "openducktor-b34",
    ]);
    expect(matchingIds({ priorities: [0, 4] })).toEqual(["openducktor-a12", "openducktor-b34"]);
    expect(matchingIds({ labels: ["ui", "bug"], issueTypes: ["bug"] })).toEqual([
      "openducktor-a12",
    ]);
    expect(matchingIds({ searchText: "fix", priorities: [2] })).toEqual([]);
  });

  test("compares labels as exact strings", () => {
    expect(matchingIds({ labels: ["UI"] })).toEqual([]);
  });
});

describe("isKanbanBoardFilterActive", () => {
  test("is active with search text or any selection, and not with spaces only", () => {
    expect(isKanbanBoardFilterActive(EMPTY_KANBAN_BOARD_FILTER)).toBe(false);
    expect(isKanbanBoardFilterActive({ ...EMPTY_KANBAN_BOARD_FILTER, searchText: "  " })).toBe(
      false,
    );
    expect(isKanbanBoardFilterActive({ ...EMPTY_KANBAN_BOARD_FILTER, searchText: "a" })).toBe(true);
    expect(isKanbanBoardFilterActive({ ...EMPTY_KANBAN_BOARD_FILTER, labels: ["ui"] })).toBe(true);
    expect(isKanbanBoardFilterActive({ ...EMPTY_KANBAN_BOARD_FILTER, issueTypes: ["bug"] })).toBe(
      true,
    );
    expect(isKanbanBoardFilterActive({ ...EMPTY_KANBAN_BOARD_FILTER, priorities: [0] })).toBe(true);
  });
});

describe("kanbanLabelOptions", () => {
  test("lists each loaded label once in alphabetical order and keeps selected labels", () => {
    expect(kanbanLabelOptions(createTasks(), [])).toEqual(["bug", "kanban", "ui"]);
    expect(kanbanLabelOptions(createTasks(), ["removed", "ui"])).toEqual([
      "bug",
      "kanban",
      "removed",
      "ui",
    ]);
  });
});
