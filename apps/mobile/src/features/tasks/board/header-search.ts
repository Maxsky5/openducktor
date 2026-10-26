import type { KanbanBoardFilterModel } from "@openducktor/frontend-core/tasks/board/use-kanban-board-filter-model";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import type { SearchBarCommands } from "react-native-screens";

/**
 * The header search bar of the board and the text that it shows. The bar outlives the board of
 * one workspace, so the board of the next workspace can write its own search text into it.
 */
export type HeaderSearch = {
  /** The `ref` of `headerSearchBarOptions`. */
  bar: RefObject<SearchBarCommands | null>;
  text: RefObject<string>;
};

export function useHeaderSearch(): HeaderSearch {
  const bar = useRef<SearchBarCommands>(null);
  const text = useRef("");
  return useMemo(() => ({ bar, text }), []);
}

/**
 * Keeps the bar on the stored search text. The bar keeps its own text, so after Clear, the filter
 * sheet, or a workspace change sets the stored text, the board writes that text into the bar.
 * Returns the handler for the text that the user types, which comes back without a write.
 */
export function useHeaderSearchText(
  search: HeaderSearch,
  filter: Pick<KanbanBoardFilterModel, "value" | "onChange">,
): (text: string) => void {
  const { searchText } = filter.value;
  const { onChange } = filter;
  useEffect(() => {
    const bar = search.bar.current;
    if (!bar || search.text.current === searchText) return;
    bar.setText(searchText);
    search.text.current = searchText;
  }, [search, searchText]);
  return useCallback(
    (text: string) => {
      search.text.current = text;
      onChange({ searchText: text });
    },
    [onChange, search],
  );
}
