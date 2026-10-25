import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import {
  EMPTY_KANBAN_BOARD_FILTER,
  type KanbanBoardFilter,
} from "@openducktor/frontend-core/tasks/board/kanban-board-filter";
import { act, renderHook } from "@testing-library/react";
import type { SearchBarCommands } from "react-native-screens";
import { type HeaderSearch, useHeaderSearch, useHeaderSearchText } from "./header-search";

const fakeBar = (writes: string[]): SearchBarCommands => ({
  focus: () => {},
  blur: () => {},
  clearText: () => {},
  toggleCancelButton: () => {},
  setText: (text) => writes.push(text),
  cancelSearch: () => {},
});

/** One board: its stored filter, which the typed text changes, and the bar handler. */
const renderBoard = (search: HeaderSearch, searchText: string) => {
  let stored: KanbanBoardFilter = { ...EMPTY_KANBAN_BOARD_FILTER, searchText };
  const onChange = (patch: Partial<KanbanBoardFilter>) => {
    stored = { ...stored, ...patch };
  };
  const hook = renderHook(
    ({ value }: { value: KanbanBoardFilter }) => useHeaderSearchText(search, { value, onChange }),
    { initialProps: { value: stored } },
  );
  return { ...hook, stored: () => stored };
};

const mountedSearch = (writes: string[]): HeaderSearch => {
  const search = renderHook(() => useHeaderSearch()).result.current;
  search.bar.current = fakeBar(writes);
  return search;
};

describe("useHeaderSearchText", () => {
  test("does not write typed text back into the bar", () => {
    const writes: string[] = [];
    const board = renderBoard(mountedSearch(writes), "");

    act(() => board.result.current("login"));
    board.rerender({ value: board.stored() });

    expect(board.stored().searchText).toBe("login");
    expect(writes).toEqual([]);
  });

  test("clears the bar when Clear empties the stored search", () => {
    const writes: string[] = [];
    const board = renderBoard(mountedSearch(writes), "");
    act(() => board.result.current("login"));
    board.rerender({ value: board.stored() });

    board.rerender({ value: EMPTY_KANBAN_BOARD_FILTER });

    expect(writes).toEqual([""]);
  });

  test("shows the stored search of the next workspace in the same bar", () => {
    const writes: string[] = [];
    const search = mountedSearch(writes);
    const first = renderBoard(search, "");
    act(() => first.result.current("login"));
    first.rerender({ value: first.stored() });
    first.unmount();

    renderBoard(search, "crash");

    expect(writes).toEqual(["crash"]);
  });
});
