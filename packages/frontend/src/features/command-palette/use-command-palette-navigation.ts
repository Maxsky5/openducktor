import { type RefObject, useState } from "react";
import { entryValue, type PaletteEntry } from "./command-palette-groups";
import type { PaletteTaskView } from "./command-palette-task-model";
import type { PaletteTask } from "./command-palette-types";
import type { CommandPaletteMainList } from "./use-command-palette-main-list";
import type { PaletteRowList } from "./use-command-palette-row-list";

/** A task or chat row. These rows have an action list. */
export type PaletteRowEntry = Extract<PaletteEntry, { kind: "task" | "chat" }>;

/**
 * The open list. A row action list and a reply view keep the main list query to restore on the
 * way back.
 */
export type PaletteList =
  | { kind: "main" }
  | { kind: "row"; entry: PaletteRowEntry; savedQuery: string }
  | { kind: "reply"; entry: PaletteRowEntry; savedQuery: string };

/**
 * A highlight that the user moved in the list with keys or the pointer, or that the palette set.
 * cmdk scrolls to a key move and leaves a pointer move in place. The palette scrolls to its own.
 */
export type HighlightedRow = { value: string; fromList: boolean };

export type CommandPaletteNavigation = {
  query: string;
  list: PaletteList;
  highlighted: HighlightedRow | null;
  /** Counts each highlight that the palette sets. */
  highlightRequest: number;
  highlightFromList: (value: string) => void;
  /** A new query, scope, or list highlights its best row again. */
  resetHighlight: () => void;
  changeQuery: (next: string) => void;
  showActions: (entry: PaletteRowEntry) => void;
  /** Show the questions and permission requests of a row, with forms to reply in place. */
  showReply: (entry: PaletteRowEntry) => void;
  /** Return to the main list with the saved query and the row highlighted. */
  back: () => void;
};

/** The query, the open list, and the highlighted row. */
export function useCommandPaletteNavigation(
  inputRef: RefObject<HTMLInputElement | null>,
): CommandPaletteNavigation {
  const [query, setQuery] = useState("");
  const [list, setList] = useState<PaletteList>({ kind: "main" });
  const [highlighted, setHighlighted] = useState<HighlightedRow | null>(null);
  const [highlightRequest, setHighlightRequest] = useState(0);
  /** The list scrolls to a highlight that the palette sets, also when the row stays the same. */
  const setHighlight = (next: HighlightedRow | null): void => {
    setHighlighted(next);
    setHighlightRequest((request) => request + 1);
  };
  const resetHighlight = (): void => setHighlight(null);
  const highlightFromList = (value: string): void => setHighlighted({ value, fromList: true });
  const changeQuery = (next: string): void => {
    setQuery(next);
    resetHighlight();
  };
  const showActions = (entry: PaletteRowEntry): void => {
    setList({ kind: "row", entry, savedQuery: query });
    changeQuery("");
    inputRef.current?.focus();
  };
  const showReply = (entry: PaletteRowEntry): void => {
    setList({ kind: "reply", entry, savedQuery: list.kind === "main" ? query : list.savedQuery });
    changeQuery("");
  };
  const back = (): void => {
    if (list.kind === "main") return;
    setQuery(list.savedQuery);
    setHighlight({ value: list.entry.item.key, fromList: false });
    setList({ kind: "main" });
    inputRef.current?.focus();
  };
  return {
    query,
    list,
    highlighted,
    highlightRequest,
    highlightFromList,
    resetHighlight,
    changeQuery,
    showActions,
    showReply,
    back,
  };
}

export type PaletteHighlight = {
  /** The highlighted value. It moves to the first row when its row leaves the list. */
  value: string;
  /** True when the palette set the highlight, so the palette must scroll it into view. */
  needsScroll: boolean;
  /** Values of the enabled rows, in list order. Only these can take the highlight. */
  enabledValues: string[];
  /** The highlighted row of the main list. */
  entry: PaletteEntry | undefined;
  /** The task view of a highlighted task row. */
  taskView: PaletteTaskView | null;
};

export const highlightOf = ({
  highlighted,
  rowList,
  main,
  taskViewOf,
}: {
  highlighted: HighlightedRow | null;
  rowList: PaletteRowList | null;
  main: CommandPaletteMainList;
  taskViewOf: (task: PaletteTask) => PaletteTaskView;
}): PaletteHighlight => {
  const enabledValues = rowList
    ? rowList.actions.filter((action) => !action.disabled).map((action) => action.key)
    : main.enabledValues;
  const kept = highlighted !== null && enabledValues.includes(highlighted.value);
  const value = kept ? highlighted.value : (enabledValues[0] ?? "");
  const entry = rowList ? undefined : main.entries.find((item) => entryValue(item) === value);
  return {
    value,
    needsScroll: !(kept && highlighted.fromList),
    enabledValues,
    entry,
    taskView: entry?.kind === "task" ? taskViewOf(entry.item) : null,
  };
};
