import { TriangleAlert } from "lucide-react";
import type { ReactElement } from "react";
import { sessionSourceIssueText } from "@/components/layout/sidebar/session-navigation-entry-model";
import { CommandGroup } from "@/components/ui/command";
import type { PaletteGroup } from "./command-palette-groups";
import { ActionRow, ChatRow, RowActionRow, TaskRow } from "./command-palette-rows";
import type { PaletteAction, PaletteChat, PaletteTask } from "./command-palette-types";
import type { CommandPaletteData } from "./use-command-palette-data";
import type { PaletteRowEntry } from "./use-command-palette-navigation";
import type { PaletteRowList } from "./use-command-palette-row-list";

const NOTE_CLASS_NAME = "px-4 py-3 text-sm text-muted-foreground";

/** Group headings line up with the row icons. */
const GROUP_CLASS_NAME = "[&_[cmdk-group-heading]]:px-3";

/** The grouped actions, tasks, and chats, then `New task “<query>”` for a query. */
export function MainResults({
  groups,
  data,
  query,
  showWorkspace,
  createFromQuery,
  onRunAction,
  onOpenTask,
  onShowActions,
  onOpenChat,
}: {
  groups: readonly PaletteGroup[];
  data: CommandPaletteData;
  query: string;
  showWorkspace: boolean;
  createFromQuery: PaletteAction | null;
  onRunAction: (action: PaletteAction) => void;
  onOpenTask: (task: PaletteTask) => void;
  onShowActions: (entry: PaletteRowEntry) => void;
  onOpenChat: (chat: PaletteChat) => void;
}): ReactElement {
  const hasMatches = groups.some((group) => group.entries.length > 0);
  const hasQuery = query.trim() !== "";
  return (
    <>
      <ReadIssues issues={data.issues} />
      {groups.map((group) => (
        <CommandGroup key={group.id} heading={group.heading} className={GROUP_CLASS_NAME}>
          {group.entries.map((entry) => {
            if (entry.kind === "action") {
              return (
                <ActionRow
                  key={entry.item.key}
                  item={entry.item}
                  query={query}
                  onSelect={() => onRunAction(entry.item)}
                />
              );
            }
            const sessionEntry = data.sessionEntriesByKey.get(entry.item.key)?.[0] ?? null;
            if (entry.kind === "task") {
              const task = entry.item;
              return (
                <TaskRow
                  key={task.key}
                  item={task}
                  query={query}
                  sessionEntry={sessionEntry}
                  showWorkspace={showWorkspace}
                  onSelect={() => onOpenTask(task)}
                  onShowActions={() => onShowActions(entry)}
                />
              );
            }
            const chat = entry.item;
            return (
              <ChatRow
                key={chat.key}
                item={chat}
                query={query}
                sessionEntry={sessionEntry}
                showWorkspace={showWorkspace}
                onSelect={() => onOpenChat(chat)}
                onShowActions={() => onShowActions(entry)}
              />
            );
          })}
        </CommandGroup>
      ))}
      {hasQuery && !hasMatches ? (
        // A workspace that is still loading can have matches, so show Loading, not No results.
        <p className={NOTE_CLASS_NAME}>
          {data.isLoading ? "Loading tasks and chats…" : "No results"}
        </p>
      ) : null}
      {createFromQuery ? (
        <CommandGroup heading={hasMatches ? "Create" : undefined} className={GROUP_CLASS_NAME}>
          {/* The label holds the whole query, so a mark would add nothing. */}
          <ActionRow
            item={createFromQuery}
            query=""
            onSelect={() => onRunAction(createFromQuery)}
          />
        </CommandGroup>
      ) : null}
    </>
  );
}

/** The action list of one task or chat. A note shows why some actions are missing. */
export function RowActionResults({
  list,
  query,
}: {
  list: PaletteRowList;
  query: string;
}): ReactElement {
  const { actions, note } = list;
  return (
    <>
      {note ? <p className="px-4 pb-1 pt-2 text-xs text-muted-foreground">{note}</p> : null}
      <CommandGroup
        heading={list.entry.kind === "task" ? "Task actions" : "Chat actions"}
        className={GROUP_CLASS_NAME}
      >
        {actions.map((action) => (
          <RowActionRow key={action.key} item={action} query={query} onSelect={action.run} />
        ))}
      </CommandGroup>
      {actions.length === 0 ? <p className={NOTE_CLASS_NAME}>No matching actions</p> : null}
    </>
  );
}

function ReadIssues({ issues }: { issues: CommandPaletteData["issues"] }): ReactElement {
  return (
    <>
      {issues.map((issue) => (
        <div
          key={`${issue.workspace.workspaceId}:${issue.source}`}
          className="mb-1 flex items-start gap-2 rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning-surface-foreground"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{sessionSourceIssueText(issue)}</span>
        </div>
      ))}
    </>
  );
}
