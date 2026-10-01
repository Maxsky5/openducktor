import { CircleAlert, LoaderCircle } from "lucide-react";
import { useId, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  SESSION_GROUP_LABELS,
  sessionEntryAccessibleName,
  sessionEntryIcon,
  sessionSourceIssueText,
} from "./session-navigation-entry-model";
import {
  SessionEntryStatusDot,
  SessionSelectionIndicator,
  SessionSourceIssues,
} from "./session-navigation-parts";
import { SessionPresence, SessionPresenceList } from "./session-navigation-presence";
import type { SessionSelection } from "./session-navigation-selection";
import {
  SESSION_GROUP_COUNT_CLASSES,
  sessionEntryIconClassName,
  sessionEntrySurfaceClassName,
} from "./session-navigation-styles";

type SessionNavigationRailProps = {
  model: SessionNavigationModel;
  selection: SessionSelection;
  now: number;
  onOpen: (entry: SessionNavigationEntry, target?: SessionNavigationTarget) => void;
  onRetry: (issue: SessionNavigationSourceIssue) => void;
};

/** The collapsed session list: one icon per session under the same three groups. */
export function SessionNavigationRail({
  model,
  selection,
  now,
  onOpen,
  onRetry,
}: SessionNavigationRailProps): ReactElement {
  const visibleGroups = model.groups.filter(
    (group) => group.id !== "recent" || group.entries.length > 0,
  );
  const issueText = model.issues.map(sessionSourceIssueText).join("\n");
  return (
    <SessionPreviewProvider>
      <div className="flex w-full flex-col items-center gap-3">
        <div className="flex w-full flex-col">
          <SessionPresenceList isLoading={model.isLoading}>
            {visibleGroups.map((group) => (
              <SessionRailGroup
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
          <LoaderCircle
            className="size-4 animate-spin text-sidebar-muted-foreground"
            aria-label="Loading sessions"
            role="status"
          />
        ) : null}
        {model.issues.length > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8 text-warning-accent"
                aria-label="Session list is incomplete. Show problems"
                title={issueText}
              >
                <CircleAlert aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="right" align="start" className="w-80 p-3">
              <p className="mb-2 text-sm font-medium">Session list is incomplete.</p>
              <SessionSourceIssues issues={model.issues} onRetry={onRetry} />
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    </SessionPreviewProvider>
  );
}

function SessionRailIcon({
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
  const Icon = sessionEntryIcon(entry);
  const readStatusId = useId();
  return (
    <SessionEntryPreview entry={entry} isVisible={isVisible} now={now} onOpen={onOpen}>
      <button
        type="button"
        aria-current={isSelected ? "true" : undefined}
        aria-label={sessionEntryAccessibleName(entry)}
        aria-describedby={readStatusId}
        onClick={() => {
          if (!isVisible) onOpen(entry);
        }}
        className={cn(
          // The margin keeps the group label in view when the rail scrolls to this icon.
          "relative flex size-9 shrink-0 cursor-pointer scroll-mt-8 items-center justify-center rounded-md outline-none",
          sessionEntrySurfaceClassName(entry, isSelected),
        )}
      >
        <Icon className={cn("size-4", sessionEntryIconClassName(entry))} aria-hidden="true" />
        <SessionEntryStatusDot
          entry={entry}
          id={readStatusId}
          className="absolute -left-0.5 -top-0.5"
        />
        {isSelected ? <SessionSelectionIndicator className="absolute -right-1 -top-1" /> : null}
      </button>
    </SessionEntryPreview>
  );
}

function SessionRailGroup({
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
  const label = SESSION_GROUP_LABELS[group.id];
  return (
    <SessionPresence as="section" label={label} className="w-full">
      <div className="flex w-full flex-col items-center gap-2 pb-4">
        <p className="flex w-full flex-wrap items-center justify-center gap-1 text-center text-[10px] font-medium leading-tight text-sidebar-foreground">
          <span>{label}</span>
          <span
            className={cn(
              "rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
              SESSION_GROUP_COUNT_CLASSES[group.id],
            )}
          >
            {group.entries.length}
          </span>
        </p>
        <ul className="w-full">
          <SessionPresenceList isLoading={isLoading}>
            {group.entries.map((entry) => (
              <SessionPresence as="li" key={entry.key}>
                <div className="flex justify-center px-1 pb-1.5 pt-1">
                  <SessionRailIcon
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
      </div>
    </SessionPresence>
  );
}
