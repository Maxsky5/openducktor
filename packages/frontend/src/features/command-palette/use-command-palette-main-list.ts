import { useMemo } from "react";
import {
  emptyQueryGroups,
  entryValue,
  isEnabledEntry,
  type PaletteEntry,
  type PaletteGroup,
  searchGroups,
} from "./command-palette-groups";
import { rankActions, rankChats, rankTasks } from "./command-palette-search";
import type { PaletteAction, PaletteChat, PaletteTask } from "./command-palette-types";
import { useRecentItemsStore } from "./recent-items";
import type { CommandPaletteData } from "./use-command-palette-data";

export type CommandPaletteMainList = {
  groups: PaletteGroup[];
  entries: PaletteEntry[];
  /** Values of the enabled rows, in list order. Only these can take the highlight. */
  enabledValues: string[];
  taskByKey: ReadonlyMap<string, PaletteTask>;
  chatByKey: ReadonlyMap<string, PaletteChat>;
};

/**
 * The main list: search results for a query, else the suggested actions and Recent. The hook
 * ranks tasks and chats again only when the query or the data changes.
 */
export function useCommandPaletteMainList({
  query,
  isShown,
  data,
  actions,
  createFromQuery,
}: {
  query: string;
  /** False while the task action list replaces the main list. Search then pauses. */
  isShown: boolean;
  data: CommandPaletteData;
  actions: readonly PaletteAction[];
  createFromQuery: PaletteAction | null;
}): CommandPaletteMainList {
  const recentItems = useRecentItemsStore((state) => state.items);
  const searchQuery = isShown ? query.trim() : "";
  const taskMatches = useMemo(
    () => (searchQuery ? rankTasks(data.tasks, searchQuery) : []),
    [data.tasks, searchQuery],
  );
  const chatMatches = useMemo(
    () => (searchQuery ? rankChats(data.chats, searchQuery) : []),
    [data.chats, searchQuery],
  );
  const taskByKey = useMemo(
    () => new Map(data.tasks.map((task) => [task.key, task])),
    [data.tasks],
  );
  const chatByKey = useMemo(
    () => new Map(data.chats.map((chat) => [chat.key, chat])),
    [data.chats],
  );
  const groups = searchQuery
    ? searchGroups({
        actions: rankActions(actions, searchQuery),
        tasks: taskMatches,
        chats: chatMatches,
      })
    : emptyQueryGroups({
        actions,
        needsYouKeys: data.needsYouKeys,
        recentItems,
        taskByKey,
        chatByKey,
        loadedWorkspaceIds: data.loadedWorkspaceIds,
      });
  const entries = groups.flatMap((group) => group.entries);
  const enabledValues = entries.filter(isEnabledEntry).map(entryValue);
  if (createFromQuery?.disabledReason === null) enabledValues.push(createFromQuery.key);
  return { groups, entries, enabledValues, taskByKey, chatByKey };
}
