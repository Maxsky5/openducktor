import { taskHasSessionPage } from "@openducktor/workflows";
import { defaultFilter } from "cmdk";
import type { PaletteAction, PaletteChat, PaletteTask } from "./command-palette-types";
import { ACTION_RESULT_LIMIT, CHAT_RESULT_LIMIT, TASK_RESULT_LIMIT } from "./constants";

export type ScoredMatch<Item> = { item: Item; score: number };

export const rankActions = (
  actions: readonly PaletteAction[],
  query: string,
): ScoredMatch<PaletteAction>[] =>
  rankItems(
    actions,
    query,
    (action) => ({ text: action.label, keywords: action.keywords }),
    keepOrder,
    ACTION_RESULT_LIMIT,
  );

export const rankTasks = (
  tasks: readonly PaletteTask[],
  query: string,
): ScoredMatch<PaletteTask>[] =>
  rankItems(
    tasks,
    query,
    ({ task }) => ({ text: task.title, keywords: [task.id, ...task.labels] }),
    compareTasks,
    TASK_RESULT_LIMIT,
  );

export const rankChats = (
  chats: readonly PaletteChat[],
  query: string,
): ScoredMatch<PaletteChat>[] =>
  rankItems(
    chats,
    query,
    (chat) => ({ text: chat.title, keywords: [] }),
    compareChats,
    CHAT_RESULT_LIMIT,
  );

/** The row actions that match the query, in list order. */
export const filterActions = <Action extends { label: string; keywords: readonly string[] }>(
  actions: readonly Action[],
  query: string,
): Action[] =>
  query
    ? actions.filter((action) => defaultFilter(action.label, query, [...action.keywords]) > 0)
    : [...actions];

/**
 * Score each item with the cmdk scorer, which ignores case and accepts partial and subsequence
 * matches. Keep matches only, best first, and break ties with `compare`.
 */
const rankItems = <Item>(
  items: readonly Item[],
  query: string,
  fields: (item: Item) => { text: string; keywords: readonly string[] },
  compare: (left: Item, right: Item) => number,
  limit: number,
): ScoredMatch<Item>[] => {
  const matches: ScoredMatch<Item>[] = [];
  for (const item of items) {
    const { text, keywords } = fields(item);
    const score = defaultFilter(text, query, [...keywords]);
    if (score > 0) matches.push({ item, score });
  }
  matches.sort((left, right) => right.score - left.score || compare(left.item, right.item));
  return matches.slice(0, limit);
};

const keepOrder = (): number => 0;

/** Tasks that are not closed come first, then the latest update. */
const compareTasks = (left: PaletteTask, right: PaletteTask): number => {
  const leftClosed = !taskHasSessionPage(left.task);
  if (leftClosed !== !taskHasSessionPage(right.task)) return leftClosed ? 1 : -1;
  return right.task.updatedAt.localeCompare(left.task.updatedAt);
};

const chatActivity = (chat: PaletteChat): number =>
  chat.session.lastActivityAt ?? chat.session.createdAt;

const compareChats = (left: PaletteChat, right: PaletteChat): number =>
  chatActivity(right) - chatActivity(left);
