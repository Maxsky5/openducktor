import { Reply } from "lucide-react";
import { createElement } from "react";
import { workspaceSessionReadKey } from "@openducktor/frontend-core/sessions/navigation/session-read-keys";
import { useSessionUnreadKey } from "@openducktor/frontend-core/sessions/navigation/session-read-state";
import type { SessionNavigationEntry } from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import { paletteChatActions } from "./command-palette-chat-actions";
import { filterActions } from "./command-palette-search";
import type { PaletteTaskView } from "./command-palette-task-model";
import type { PaletteRowAction, PaletteTask } from "./command-palette-types";
import type { CommandPaletteMainList } from "./use-command-palette-main-list";
import type { PaletteList, PaletteRowEntry } from "./use-command-palette-navigation";
import type { CommandPaletteRunners } from "./use-command-palette-runners";

/** The action list of one task or chat row. It replaces the main list. */
export type PaletteRowList = {
  /** The row with its latest data, or the row that opened the list when the row is gone. */
  entry: PaletteRowEntry;
  /** Why some actions are missing, such as while the saved sessions load, or null. */
  note: string | null;
  /** The actions that match the query. */
  actions: PaletteRowAction[];
};

type RowListOptions = {
  query: string;
  taskViewOf: (task: PaletteTask) => PaletteTaskView;
  runners: Pick<CommandPaletteRunners, "runTaskCommand" | "chatHandlers">;
  showReply: (entry: PaletteRowEntry) => void;
};

/** The open row action list, or null for the main list. */
export function usePaletteRowList(
  list: PaletteList,
  main: CommandPaletteMainList,
  options: RowListOptions & {
    sessionEntriesByKey: ReadonlyMap<string, SessionNavigationEntry[]>;
  },
): PaletteRowList | null {
  const row = openRowOf(list, main);
  const chatUnread = useSessionUnreadKey(
    row?.kind === "chat"
      ? workspaceSessionReadKey(row.item.workspace.workspaceId, row.item.session)
      : null,
  );
  if (!row) return null;
  return rowListOf(row, {
    ...options,
    sessionEntries: options.sessionEntriesByKey.get(row.item.key) ?? [],
    chatUnread,
  });
}

/** The row of an open action list with its latest data, or null for the main list. */
export const openRowOf = (
  list: PaletteList,
  main: CommandPaletteMainList,
): PaletteRowEntry | null => {
  if (list.kind !== "row") return null;
  const { entry } = list;
  if (entry.kind === "task") {
    return { kind: "task", item: main.taskByKey.get(entry.item.key) ?? entry.item };
  }
  return { kind: "chat", item: main.chatByKey.get(entry.item.key) ?? entry.item };
};

/**
 * The actions of a row that match the query, with Reply first when a session of the row waits
 * for an answer. Each action runs through the palette runners.
 */
export const rowListOf = (
  entry: PaletteRowEntry,
  {
    query,
    taskViewOf,
    runners,
    showReply,
    sessionEntries,
    chatUnread,
  }: RowListOptions & {
    /** The sidebar entries of the row. */
    sessionEntries: readonly SessionNavigationEntry[];
    /** Whether the chat of the list shows as unread. */
    chatUnread: boolean;
  },
): PaletteRowList => {
  const search = query.trim();
  const reply = replyAction(sessionEntries, () => showReply(entry));
  if (entry.kind === "chat") {
    const chat = entry.item;
    const actions = paletteChatActions(chat, chatUnread, runners.chatHandlers(chat));
    return { entry, note: null, actions: filterActions([...reply, ...actions], search) };
  }
  const task = entry.item;
  const taskView = taskViewOf(task);
  const taskActions = taskView.actions.map((action) => ({
    ...action,
    run: () => runners.runTaskCommand(task, action.command, taskView),
  }));
  return {
    entry,
    note: taskView.sessionsNote,
    actions: filterActions([...reply, ...taskActions], search),
  };
};

/** The first action of a row that waits for a reply, or none. */
const replyAction = (
  sessionEntries: readonly SessionNavigationEntry[],
  showReply: () => void,
): PaletteRowAction[] => {
  const label = replyLabel(sessionEntries);
  if (label === null) return [];
  return [
    {
      key: "reply",
      label,
      keywords: ["answer", "approve", "needs you", "question", "permission"],
      icon: createElement(Reply),
      destructive: false,
      disabled: false,
      run: showReply,
    },
  ];
};

const replyLabel = (sessionEntries: readonly SessionNavigationEntry[]): string | null => {
  const reasons = new Set(sessionEntries.flatMap((entry) => entry.attention));
  const question = reasons.has("question");
  const permission = reasons.has("permission");
  if (question && permission) return "Reply to requests";
  if (question) return "Reply to question";
  if (permission) return "Reply to permission request";
  return null;
};
