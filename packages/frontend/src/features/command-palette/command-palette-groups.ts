import type { ScoredMatch } from "./command-palette-search";
import type { PaletteAction, PaletteChat, PaletteTask } from "./command-palette-types";
import { RECENT_ITEMS_SHOWN_LIMIT } from "./constants";
import { type RecentItem, recentItemKey } from "./recent-items";

export type PaletteEntry =
  | { kind: "action"; item: PaletteAction }
  | { kind: "task"; item: PaletteTask }
  | { kind: "chat"; item: PaletteChat };

export type PaletteGroup = { id: string; heading: string; entries: PaletteEntry[] };

/** A group with the score of its best match, so the best group can come first. */
type ScoredGroup = { score: number; group: PaletteGroup };

export type RankedMatches = {
  actions: ScoredMatch<PaletteAction>[];
  tasks: ScoredMatch<PaletteTask>[];
  chats: ScoredMatch<PaletteChat>[];
};

/**
 * Search results in groups. The group with the best match comes first, and equal groups keep the
 * order Actions, Tasks, Chats. A match far weaker than the best match of any group is a scattered
 * letter match, such as "theme" in "Go to Kanban", so the groups drop it.
 */
export const searchGroups = ({ actions, tasks, chats }: RankedMatches): PaletteGroup[] => {
  const minScore =
    WEAK_MATCH_RATIO * Math.max(bestScore(actions), bestScore(tasks), bestScore(chats));
  const scoredGroup = <Item>(
    id: string,
    heading: string,
    matches: ScoredMatch<Item>[],
    toEntry: (item: Item) => PaletteEntry,
  ): ScoredGroup => ({
    score: bestScore(matches),
    group: {
      id,
      heading,
      entries: matches.flatMap((match) => (match.score >= minScore ? [toEntry(match.item)] : [])),
    },
  });
  return [
    scoredGroup("actions", "Actions", actions, (item) => ({ kind: "action", item })),
    scoredGroup("tasks", "Tasks", tasks, (item) => ({ kind: "task", item })),
    scoredGroup("chats", "Chats", chats, (item) => ({ kind: "chat", item })),
  ]
    .filter(({ group }) => group.entries.length > 0)
    .toSorted((left, right) => right.score - left.score)
    .map(({ group }) => group);
};

/**
 * The list for an empty query: the tasks and chats that need you, the suggested actions, then
 * the Recent tasks and chats in scope. Items of a workspace that is still loading stay hidden.
 */
export const emptyQueryGroups = ({
  actions,
  needsYouKeys,
  recentItems,
  taskByKey,
  chatByKey,
  loadedWorkspaceIds,
}: {
  actions: readonly PaletteAction[];
  /** Row keys of the tasks and chats that wait for the user. */
  needsYouKeys: readonly string[];
  recentItems: readonly RecentItem[];
  taskByKey: ReadonlyMap<string, PaletteTask>;
  chatByKey: ReadonlyMap<string, PaletteChat>;
  loadedWorkspaceIds: ReadonlySet<string>;
}): PaletteGroup[] => {
  const rowOf = (key: string): PaletteEntry[] => {
    const task = taskByKey.get(key);
    if (task) return [{ kind: "task", item: task }];
    const chat = chatByKey.get(key);
    return chat ? [{ kind: "chat", item: chat }] : [];
  };
  const needsYou = needsYouKeys.flatMap(rowOf);
  const needsYouSet = new Set(needsYouKeys);
  const recent = recentItems
    .flatMap((item): PaletteEntry[] => {
      const key = recentItemKey(item);
      // A row that needs you already shows above Recent.
      if (!loadedWorkspaceIds.has(item.workspaceId) || needsYouSet.has(key)) return [];
      return rowOf(key);
    })
    .slice(0, RECENT_ITEMS_SHOWN_LIMIT);
  return [
    ...(needsYou.length > 0 ? [{ id: "needs-you", heading: "Needs you", entries: needsYou }] : []),
    {
      id: "actions",
      heading: "Actions",
      entries: actions
        .filter((action) => action.suggested)
        .map((item): PaletteEntry => ({ kind: "action", item })),
    },
    ...(recent.length > 0 ? [{ id: "recent", heading: "Recent", entries: recent }] : []),
  ];
};

export const entryValue = (entry: PaletteEntry): string => entry.item.key;

export const isEnabledEntry = (entry: PaletteEntry): boolean =>
  entry.kind !== "action" || entry.item.disabledReason === null;

const WEAK_MATCH_RATIO = 0.1;

const bestScore = (matches: readonly ScoredMatch<unknown>[]): number => matches[0]?.score ?? 0;
