import { ChevronDown, LoaderCircle } from "lucide-react";
import { type ReactElement, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { statusBadgeClassName, statusLabel } from "@/lib/task-display";
import type { SessionNavigationTarget } from "@/features/session-navigation/session-navigation-target";
import { cn } from "@/lib/utils";
import type {
  SessionNavigationEntry,
  SessionNavigationGroup,
  SessionNavigationModel,
  SessionNavigationSourceIssue,
} from "@/state/read-models/session-navigation-read-model";
import { SessionEntryPreview, SessionPreviewProvider } from "./session-entry-preview";
import {
  SESSION_GROUP_ICONS,
  SESSION_GROUP_LABELS,
  sessionEntryAccessibleName,
  sessionEntryIcon,
  sessionEntryShortTime,
} from "./session-navigation-entry-model";
import {
  AttentionBadges,
  SessionEntryIssueIcon,
  SessionEntryRuntimeIcon,
  SessionEntryStatusDot,
  SessionSelectionIndicator,
  SessionSourceIssues,
} from "./session-navigation-parts";
import { SessionPresence, SessionPresenceList } from "./session-navigation-presence";
import type { SessionSelection } from "./session-navigation-selection";
import {
  SESSION_GROUP_COUNT_CLASSES,
  SESSION_GROUP_ICON_CLASSES,
  sessionEntryIconClassName,
  sessionEntrySurfaceClassName,
} from "./session-navigation-styles";
import { useSessionCommands } from "@/features/session-navigation/use-session-commands";
import { SessionCommandIcon } from "./session-command-activity";

type SessionNavigationListProps = {
  model: SessionNavigationModel;
  selection: SessionSelection;
  now: number;
  onOpen: (entry: SessionNavigationEntry, target?: SessionNavigationTarget) => void;
  onRetry: (issue: SessionNavigationSourceIssue) => void;
  footer?: ReactElement | null;
};

/** The expanded session list: Needs you, Running, and Recent in one scrollable column. */
export function SessionNavigationList({
  model,
  selection,
  now,
  onOpen,
  onRetry,
  footer = null,
}: SessionNavigationListProps): ReactElement {
  const visibleGroups = model.groups.filter(
    (group) => group.id !== "recent" || group.entries.length > 0,
  );
  return (
    <SessionPreviewProvider>
      <div className="flex flex-col gap-3">
        {model.issues.length > 0 ? (
          <p className="px-1 text-xs text-warning-muted">Session list is incomplete.</p>
        ) : null}
        <div className="flex flex-col">
          <SessionPresenceList isLoading={model.isLoading}>
            {visibleGroups.map((group) => (
              <SessionGroupSection
                key={group.id}
                group={group}
                isLoading={model.isLoading}
                selection={selection}
                now={now}
                onOpen={onOpen}
              />
            ))}
          </SessionPresenceList>
        </div>
        {model.isLoading ? (
          <p
            className="flex items-center gap-2 px-1 text-xs text-sidebar-muted-foreground"
            role="status"
          >
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            {model.entryCount === 0 ? "Loading sessions…" : "Loading more sessions…"}
          </p>
        ) : null}
        {!model.isLoading && model.issues.length === 0 && model.entryCount === 0 ? (
          <p className="px-1 text-sm text-sidebar-muted-foreground">
            No sessions yet. Start with New task or New chat.
          </p>
        ) : null}
        <SessionSourceIssues issues={model.issues} onRetry={onRetry} />
        {footer}
      </div>
    </SessionPreviewProvider>
  );
}

function SessionRowMetadata({
  entry,
  now,
}: {
  entry: SessionNavigationEntry;
  now: number;
}): ReactElement | null {
  if (entry.attention.length > 0) return <AttentionBadges entry={entry} />;
  const issueIcon = <SessionEntryIssueIcon entry={entry} />;
  if (entry.status.kind === "running") return issueIcon;
  const shortTime = sessionEntryShortTime(entry, now);
  return (
    <span className="flex shrink-0 items-center gap-1">
      {issueIcon}
      {shortTime ? (
        <span
          className={cn(
            "text-[10px] font-medium leading-4 tabular-nums text-sidebar-foreground",
            entry.time.kind === "started" && "italic",
          )}
        >
          {shortTime}
        </span>
      ) : null}
    </span>
  );
}

function SessionRow({
  entry,
  isSelected,
  isVisible,
  now,
  onOpen,
}: {
  entry: SessionNavigationEntry;
  isSelected: boolean;
  isVisible: boolean;
  now: number;
  onOpen: (entry: SessionNavigationEntry, target?: SessionNavigationTarget) => void;
}): ReactElement {
  const needsAttention = entry.attention.length > 0;
  const task = entry.context.kind === "task" ? entry.context.task : null;
  const Icon = sessionEntryIcon(entry);
  const readStatusId = useId();
  const commands = useSessionCommands(entry);
  const commandCount = commands.status === "ready" ? commands.commands.length : 0;
  return (
    <SessionEntryPreview entry={entry} isVisible={isVisible} now={now} onOpen={onOpen}>
      <button
        type="button"
        aria-current={isSelected ? "true" : undefined}
        aria-label={
          sessionEntryAccessibleName(entry) +
          (commandCount > 0
            ? `, ${commandCount} active ${commandCount === 1 ? "command" : "commands"}`
            : "")
        }
        aria-describedby={readStatusId}
        onClick={() => {
          if (!isVisible) onOpen(entry);
        }}
        className={cn(
          // The margin keeps the group header in view when the list scrolls to this row.
          "relative flex w-full min-w-0 cursor-pointer scroll-mt-10 flex-col rounded-md px-2.5 py-1.5 text-left outline-none",
          sessionEntrySurfaceClassName(entry, isSelected),
        )}
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <SessionEntryStatusDot entry={entry} id={readStatusId} />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium leading-4 text-sidebar-foreground">
            {entry.workspace.workspaceName}
          </span>
          {task && (
            <Badge
              variant="outline"
              className={cn(
                "h-4 shrink-0 px-1.5 py-0 text-[10px] leading-none",
                statusBadgeClassName(task.status),
              )}
            >
              {task.status === "blocked" ? "Blocked" : statusLabel(task.status)}
            </Badge>
          )}
          <SessionRowMetadata entry={entry} now={now} />
        </span>
        <span className="flex w-full min-w-0 items-center gap-2">
          <span className="relative flex size-4 shrink-0 items-center justify-center">
            <Icon className={cn("size-4", sessionEntryIconClassName(entry))} aria-hidden="true" />
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px] font-medium leading-5",
              needsAttention ? "text-warning-muted" : "text-foreground",
            )}
          >
            {entry.title}
          </span>
          <SessionCommandIcon count={commandCount} />
          <SessionEntryRuntimeIcon entry={entry} />
        </span>
        {isSelected ? <SessionSelectionIndicator className="absolute -right-1 -top-1" /> : null}
      </button>
    </SessionEntryPreview>
  );
}

function SessionGroupSection({
  group,
  isLoading,
  selection,
  now,
  onOpen,
}: {
  group: SessionNavigationGroup;
  isLoading: boolean;
  selection: SessionSelection;
  now: number;
  onOpen: (entry: SessionNavigationEntry, target?: SessionNavigationTarget) => void;
}): ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const listId = `${useId()}-session-group`;
  const Icon = SESSION_GROUP_ICONS[group.id];
  const label = SESSION_GROUP_LABELS[group.id];
  return (
    <SessionPresence as="section" label={label}>
      <div className="flex flex-col gap-2 pb-4">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={listId}
          onClick={() => setCollapsed((current) => !current)}
          className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md bg-muted/60 px-2.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Icon
            className={cn("size-4 shrink-0", SESSION_GROUP_ICON_CLASSES[group.id])}
            aria-hidden="true"
          />
          <span className="text-[13px] font-semibold text-sidebar-foreground">{label}</span>
          <span
            className={cn(
              "ml-auto min-w-5 rounded-full px-1.5 text-center text-xs font-medium tabular-nums",
              SESSION_GROUP_COUNT_CLASSES[group.id],
            )}
            aria-label={`${group.entries.length} ${group.entries.length === 1 ? "session" : "sessions"}`}
          >
            {group.entries.length}
          </span>
          <ChevronDown
            className={cn(
              "size-3 shrink-0 text-sidebar-muted-foreground",
              collapsed && "-rotate-90",
            )}
            aria-hidden="true"
          />
        </button>
        {collapsed ? null : (
          <ul id={listId}>
            <SessionPresenceList isLoading={isLoading}>
              {group.entries.map((entry) => (
                <SessionPresence as="li" key={entry.key}>
                  <div className="py-0.5">
                    <SessionRow
                      entry={entry}
                      isSelected={entry.key === selection.entryKey}
                      isVisible={entry.key === selection.visibleKey}
                      now={now}
                      onOpen={onOpen}
                    />
                  </div>
                </SessionPresence>
              ))}
            </SessionPresenceList>
          </ul>
        )}
      </div>
    </SessionPresence>
  );
}
