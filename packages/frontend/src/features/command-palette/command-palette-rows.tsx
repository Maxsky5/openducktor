import type { WorkspaceRecord } from "@openducktor/contracts";
import { Check, ChevronRight, MessagesSquare } from "lucide-react";
import { type ComponentProps, type ReactElement, type ReactNode, useId } from "react";
import { ISSUE_TYPE_STYLES } from "@/components/features/kanban/kanban-task-badge-model";
import {
  AttentionBadges,
  SessionEntryStatusDot,
} from "@/components/layout/sidebar/session-navigation-parts";
import { WorkspaceTile } from "@/components/layout/workspace-tile";
import { Badge } from "@/components/ui/badge";
import { CommandItem } from "@/components/ui/command";
import { useSessionUnread } from "@openducktor/frontend-core/sessions/navigation/session-read-state";
import { statusBadgeClassName } from "@/lib/task-status-presentation";
import { statusLabel } from "@openducktor/frontend-core/tasks/presentation/task-status-presentation";
import { cn } from "@/lib/utils";
import type { SessionNavigationEntry } from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import { MatchedText } from "./command-palette-match";
import type {
  PaletteAction,
  PaletteChat,
  PaletteRowAction,
  PaletteTask,
} from "./command-palette-types";

const ROW_CLASS_NAME =
  "group/row h-10 gap-3 rounded-lg px-3 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground";

const ROW_ICON_CLASS_NAME =
  "flex size-5 shrink-0 items-center justify-center text-muted-foreground group-data-[selected=true]/row:text-foreground [&_svg]:size-4";

export function TaskRow({
  item,
  query,
  sessionEntry,
  showWorkspace,
  onSelect,
  onShowActions,
}: {
  item: PaletteTask;
  query: string;
  /** The sidebar entry that gives the status of the row, or null for a task without sessions. */
  sessionEntry: SessionNavigationEntry | null;
  showWorkspace: boolean;
  onSelect: () => void;
  onShowActions: () => void;
}): ReactElement {
  const { task, workspace } = item;
  const issueType = ISSUE_TYPE_STYLES[task.issueType] ?? ISSUE_TYPE_STYLES.task;
  const IssueTypeIcon = issueType.icon;
  return (
    <PaletteOption value={item.key} onSelect={onSelect} className={ROW_CLASS_NAME}>
      <RowStatusDot entry={sessionEntry} />
      <IssueTypeIcon
        className={cn("size-4 shrink-0", issueType.iconClassName)}
        aria-label={issueType.label}
      />
      <span className="min-w-0 flex-1 truncate font-medium">
        <MatchedText text={task.title} query={query} />
      </span>
      {sessionEntry ? <AttentionBadges entry={sessionEntry} /> : null}
      {showWorkspace ? <RowWorkspace workspace={workspace} /> : null}
      <span className="max-w-32 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
        <MatchedText text={task.id} query={query} />
      </span>
      <Badge
        variant="outline"
        className={cn(
          "h-5 shrink-0 rounded-full px-2 py-0 text-[10px] font-medium",
          statusBadgeClassName(task.status),
        )}
      >
        {statusLabel(task.status)}
      </Badge>
      <ShowActionsButton title={task.title} onShowActions={onShowActions} />
    </PaletteOption>
  );
}

export function ChatRow({
  item,
  query,
  sessionEntry,
  showWorkspace,
  onSelect,
  onShowActions,
}: {
  item: PaletteChat;
  query: string;
  /** The sidebar entry that gives the status of the row. */
  sessionEntry: SessionNavigationEntry | null;
  showWorkspace: boolean;
  onSelect: () => void;
  onShowActions: () => void;
}): ReactElement {
  return (
    <PaletteOption value={item.key} onSelect={onSelect} className={ROW_CLASS_NAME}>
      <RowStatusDot entry={sessionEntry} />
      <span className={ROW_ICON_CLASS_NAME} aria-hidden="true">
        <MessagesSquare />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">
        <MatchedText text={item.title} query={query} />
      </span>
      {sessionEntry ? <AttentionBadges entry={sessionEntry} /> : null}
      {showWorkspace ? <RowWorkspace workspace={item.workspace} /> : null}
      <ShowActionsButton title={item.title} onShowActions={onShowActions} />
    </PaletteOption>
  );
}

export function ActionRow({
  item,
  query,
  onSelect,
}: {
  item: PaletteAction;
  query: string;
  onSelect: () => void;
}): ReactElement {
  return (
    <PaletteOption
      value={item.key}
      onSelect={onSelect}
      disabled={item.disabledReason !== null}
      className={cn(ROW_CLASS_NAME, "data-[disabled=true]:opacity-100")}
    >
      <span className={ROW_ICON_CLASS_NAME} aria-hidden="true">
        {item.icon}
      </span>
      <span
        className={cn(
          "min-w-0 truncate",
          item.disabledReason ? "text-muted-foreground" : "font-medium",
        )}
      >
        <MatchedText text={item.label} query={query} />
      </span>
      {item.workspaceName ? (
        <span className="min-w-0 shrink truncate text-muted-foreground">
          {`in ${item.workspaceName}`}
        </span>
      ) : null}
      <span className="flex-1" />
      <RowTrailing disabledReason={item.disabledReason} checked={item.checked} />
    </PaletteOption>
  );
}

export function RowActionRow({
  item,
  query,
  onSelect,
}: {
  item: PaletteRowAction;
  query: string;
  onSelect: () => void;
}): ReactElement {
  return (
    <PaletteOption
      value={item.key}
      onSelect={onSelect}
      disabled={item.disabled}
      className={cn(
        ROW_CLASS_NAME,
        item.destructive &&
          "text-destructive-muted data-[selected=true]:bg-destructive/10 data-[selected=true]:text-destructive-muted",
      )}
    >
      <span
        className={cn(
          ROW_ICON_CLASS_NAME,
          item.destructive &&
            "text-destructive-muted group-data-[selected=true]/row:text-destructive-muted",
        )}
        aria-hidden="true"
      >
        {item.icon}
      </span>
      <span className="min-w-0 truncate font-medium">
        <MatchedText text={item.label} query={query} />
      </span>
      {item.detail ? <span className="shrink-0 text-muted-foreground">{item.detail}</span> : null}
    </PaletteOption>
  );
}

/** A cmdk option that `useHighlightedOption` finds by the same value. */
function PaletteOption({
  value,
  ...props
}: ComponentProps<typeof CommandItem> & { value: string }): ReactElement {
  return <CommandItem value={value} data-palette-value={value} {...props} />;
}

/** Opens the action list of a task or chat row. The highlighted row shows it. */
function ShowActionsButton({
  title,
  onShowActions,
}: {
  title: string;
  onShowActions: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={`Show actions for ${title}`}
      title="Show actions"
      className="-mr-1.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-background hover:text-foreground group-data-[selected=true]/row:opacity-100"
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation();
        onShowActions();
      }}
    >
      <ChevronRight className="size-4" />
    </button>
  );
}

/** The sidebar status dot of a row, or an empty slot that keeps the titles aligned. */
function RowStatusDot({ entry }: { entry: SessionNavigationEntry | null }): ReactElement {
  return entry ? (
    <SessionStatusDot entry={entry} />
  ) : (
    <span aria-hidden="true" className="size-2.5 shrink-0" />
  );
}

function SessionStatusDot({ entry }: { entry: SessionNavigationEntry }): ReactElement {
  const unread = useSessionUnread(entry);
  const id = useId();
  return <SessionEntryStatusDot entry={entry} unread={unread} id={id} />;
}

function RowWorkspace({ workspace }: { workspace: WorkspaceRecord }): ReactElement {
  return (
    <span className="flex shrink-0 items-center" title={workspace.workspaceName}>
      <WorkspaceTile workspace={workspace} size="xs" className="shadow-none" />
      <span className="sr-only">{`, in ${workspace.workspaceName}`}</span>
    </span>
  );
}

function RowTrailing({
  disabledReason,
  checked,
}: {
  disabledReason: string | null;
  checked: boolean;
}): ReactNode {
  if (disabledReason) {
    return (
      <span
        className="max-w-64 shrink truncate text-xs text-muted-foreground"
        title={disabledReason}
      >
        {disabledReason}
      </span>
    );
  }
  if (checked) {
    return (
      <>
        <Check className="size-4 shrink-0 text-selected-accent" aria-hidden="true" />
        <span className="sr-only">, current</span>
      </>
    );
  }
  return null;
}
