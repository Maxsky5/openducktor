import "../../test-support/dom-environment";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { act, renderHook } from "@testing-library/react";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import { EMPTY_KANBAN_BOARD_FILTER, type KanbanBoardFilter } from "./kanban-board-filter";
import {
  useKanbanBoardFilterModel,
  useKanbanBoardFilterStore,
} from "./use-kanban-board-filter-model";

let filtersBefore: Record<string, KanbanBoardFilter>;

beforeEach(() => {
  filtersBefore = useKanbanBoardFilterStore.getState().filters;
});

afterEach(() => {
  useKanbanBoardFilterStore.setState({ filters: filtersBefore });
});

const NO_TASKS: TaskCard[] = [];

const renderFilterModel = (workspaceId: string | null, tasks: TaskCard[] = NO_TASKS) =>
  renderHook(() => useKanbanBoardFilterModel(workspaceId, tasks));

describe("useKanbanBoardFilterModel", () => {
  test("passes the loaded tasks unchanged while the filter is inactive", () => {
    const tasks = [createTaskCardFixture({ id: "TASK-1" })];
    const view = renderFilterModel("filter-model-inactive", tasks);
    try {
      expect(view.result.current.filter.isActive).toBe(false);
      expect(view.result.current.matchingTasks).toBe(tasks);
    } finally {
      view.unmount();
    }
  });

  test("matches the loaded tasks and lists their labels with the selected labels", () => {
    const tasks = [
      createTaskCardFixture({ id: "TASK-1", title: "Fix crash", labels: ["bug"] }),
      createTaskCardFixture({ id: "TASK-2", title: "Write notes", labels: ["docs"] }),
    ];
    const view = renderFilterModel("filter-model-matching", tasks);
    try {
      act(() => view.result.current.filter.onChange({ searchText: "notes", labels: ["gone"] }));

      expect(view.result.current.filter.isActive).toBe(true);
      expect(view.result.current.matchingTasks).toEqual([]);
      expect(view.result.current.filter.labelOptions).toEqual(["bug", "docs", "gone"]);

      act(() => view.result.current.filter.onChange({ labels: [] }));

      expect(view.result.current.matchingTasks.map((task) => task.id)).toEqual(["TASK-2"]);
    } finally {
      view.unmount();
    }
  });

  test("keeps a separate filter for each workspace", () => {
    const first = renderFilterModel("filter-model-first");
    const second = renderFilterModel("filter-model-second");
    try {
      act(() => first.result.current.filter.onChange({ searchText: "crash", issueTypes: ["bug"] }));

      expect(first.result.current.filter.value).toEqual({
        ...EMPTY_KANBAN_BOARD_FILTER,
        searchText: "crash",
        issueTypes: ["bug"],
      });
      expect(second.result.current.filter.value).toBe(EMPTY_KANBAN_BOARD_FILTER);
    } finally {
      first.unmount();
      second.unmount();
    }
  });

  test("applies each change to the current filter, so quick changes keep each other", () => {
    const view = renderFilterModel("filter-model-quick");
    try {
      const { onChange } = view.result.current.filter;
      act(() => {
        onChange({ searchText: "a" });
        onChange({ priorities: [0] });
      });

      expect(view.result.current.filter.value).toEqual({
        ...EMPTY_KANBAN_BOARD_FILTER,
        searchText: "a",
        priorities: [0],
      });
    } finally {
      view.unmount();
    }
  });

  test("keeps the filter after the reader unmounts, and clears only its own workspace", () => {
    const first = renderFilterModel("filter-model-kept");
    act(() => first.result.current.filter.onChange({ labels: ["ui"] }));
    first.unmount();
    const other = renderFilterModel("filter-model-other");
    act(() => other.result.current.filter.onChange({ searchText: "notes" }));

    const remounted = renderFilterModel("filter-model-kept");
    try {
      expect(remounted.result.current.filter.value.labels).toEqual(["ui"]);

      act(() => remounted.result.current.filter.onClear());

      expect(remounted.result.current.filter.value).toEqual(EMPTY_KANBAN_BOARD_FILTER);
      expect(other.result.current.filter.value.searchText).toBe("notes");
    } finally {
      remounted.unmount();
      other.unmount();
    }
  });

  test("disables the model, reads the empty filter, and throws on a change without a workspace", () => {
    const view = renderFilterModel(null);
    try {
      expect(view.result.current.filter.isDisabled).toBe(true);
      expect(view.result.current.filter.value).toBe(EMPTY_KANBAN_BOARD_FILTER);
      expect(() => view.result.current.filter.onChange({ searchText: "lost" })).toThrow(
        "The Kanban board filter has no workspace.",
      );
      expect(() => view.result.current.filter.onClear()).toThrow(
        "The Kanban board filter has no workspace.",
      );
    } finally {
      view.unmount();
    }
  });
});
