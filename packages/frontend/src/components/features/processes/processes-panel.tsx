import type { WorkspaceProcessIssue, WorkspaceProcessList } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { workspaceProcessQueryKeys } from "@openducktor/frontend-core/queries/workspace-processes";
import { useQueryClient } from "@tanstack/react-query";
import { Cpu, Search, SearchX, TriangleAlert, X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { CssPresenceList } from "@/components/ui/css-presence";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useWorkspaceScope } from "@/state/app-state-provider";
import { ProcessGroupSection } from "./process-group-section";
import {
  LIVE_REFRESH_MS,
  PROCESSES_SURFACE,
  useProcessList,
  useProcessesActions,
  useProcessesViewState,
} from "./processes-context";
import { countLabel } from "./processes-labels";
import {
  buildGroupViews,
  contextRank,
  firstServerUrl,
  type ProcessGroupView,
  processTotals,
} from "./processes-view";
import { useProcessStops } from "./use-process-stops";
import "./processes.css";

const COMMAND_SELECTOR = "[data-process-command]";

const wholeList = (list: WorkspaceProcessList) => list;

type ProcessesPanelProps = {
  filterRef: RefObject<HTMLInputElement | null>;
  filter: string;
  onFilterChange: (filter: string) => void;
  /** Buttons of the surface at the end of the toolbar, such as Detach and Close of the flyout. */
  toolbarActions?: ReactNode;
  className?: string;
  /** The height rules of the list in its surface. */
  listClassName?: string;
};

/**
 * The commands of all open workspaces, with the checkouts of the current task first and the
 * other workspaces folded. The flyout of the rail and the floating window show it. It renders
 * again only for its own props, so a move of the floating window leaves the list alone.
 */
export const ProcessesPanel = memo(function ProcessesPanel({
  filterRef,
  filter,
  onFilterChange,
  toolbarActions,
  className,
  listClassName,
}: ProcessesPanelProps): ReactElement | null {
  const actions = useProcessesActions();
  const { focus } = useProcessesViewState();
  const titleId = useId();
  const { workspaces } = useWorkspaceScope();
  const listRef = useRef<HTMLDivElement | null>(null);
  // The list also changes at once just after the filter clears, so the full list does not
  // grow back line by line.
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    if (!settling) return;
    const timer = window.setTimeout(() => setSettling(false), 300);
    return () => window.clearTimeout(timer);
  }, [settling]);
  const changeFilter = useCallback(
    (value: string) => {
      setSettling(true);
      onFilterChange(value);
    },
    [onFilterChange],
  );
  const queryClient = useQueryClient();
  const query = useProcessList(wholeList);
  const stops = useProcessStops();
  const list = query.data;
  const openWorkspaceIds = useMemo(
    () => new Set(workspaces.map((workspace) => workspace.workspaceId)),
    [workspaces],
  );
  const activeWorkspaceId = actions?.activeWorkspaceId ?? null;
  // A closed workspace leaves the list at once, before the next read.
  const openGroups = useMemo(
    () => list?.groups.filter((group) => openWorkspaceIds.has(group.workspaceId)) ?? [],
    [list, openWorkspaceIds],
  );
  const rankOf = useCallback(
    (entry: ProcessGroupView) => contextRank(entry.group, focus, activeWorkspaceId),
    [focus, activeWorkspaceId],
  );
  const views = useMemo(
    () => buildGroupViews(openGroups, filter).sort((left, right) => rankOf(left) - rankOf(right)),
    [openGroups, filter, rankOf],
  );
  const allViews = useMemo(() => buildGroupViews(openGroups, ""), [openGroups]);
  const failedRead = query.isError;
  const { isOutdated } = stops;
  const isRowOutdated = useCallback(
    (row: Parameters<typeof isOutdated>[0]) => failedRead || isOutdated(row),
    [failedRead, isOutdated],
  );
  const retry = useCallback(
    () => void queryClient.refetchQueries({ queryKey: workspaceProcessQueryKeys.all }),
    [queryClient],
  );
  const filtering = filter.trim() !== "";
  const enterUrl = filtering ? firstServerUrl(views) : null;
  if (!actions) return null;
  const { openUrl } = actions;

  // ArrowDown and ArrowUp move between the commands. ArrowUp on the first one returns to the filter.
  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const commands = [...(listRef.current?.querySelectorAll<HTMLElement>(COMMAND_SELECTOR) ?? [])];
    const index = commands.findIndex((command) => command === document.activeElement);
    if (index === -1) return;
    event.preventDefault();
    const next = event.key === "ArrowDown" ? commands[index + 1] : commands[index - 1];
    if (next) next.focus();
    else if (event.key === "ArrowUp") filterRef.current?.focus();
  };
  const onFilterKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Enter opens the first server that the filter shows. ArrowDown moves into the list.
    if (event.key === "Enter" && enterUrl) {
      event.preventDefault();
      openUrl(enterUrl);
    }
    if (event.key === "ArrowDown") {
      const first = listRef.current?.querySelector<HTMLElement>(COMMAND_SELECTOR);
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  return (
    <div role="region" aria-labelledby={titleId} className={cn("flex min-h-0 flex-col", className)}>
      {/*
        One toolbar: the search field leads and the live counts follow. The surface can add its
        own buttons, as the flyout adds Detach and Close.
      */}
      <div
        className={cn(
          "group/toolbar flex h-12 shrink-0 items-center gap-2 border-b border-border/70 pl-3.5",
          toolbarActions ? "pr-2" : "pr-3.5",
        )}
        onKeyDown={onFilterKeyDown}
      >
        <h2 id={titleId} className="sr-only">
          Processes
        </h2>
        <Search
          className="size-4 shrink-0 text-muted-foreground/70 transition-colors group-focus-within/toolbar:text-foreground"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <input
          ref={filterRef}
          type="text"
          aria-label="Filter processes"
          value={filter}
          placeholder="Search commands"
          spellCheck={false}
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
          onChange={(event) => changeFilter(event.target.value)}
        />
        {filter ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 text-muted-foreground"
            aria-label="Clear filter"
            onClick={() => {
              changeFilter("");
              filterRef.current?.focus();
            }}
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        ) : null}
        <span className="flex shrink-0 items-center gap-1.5">
          <LiveStatus failed={failedRead} />
          <ProcessSummary views={allViews} matches={filtering ? views : null} />
        </span>
        {list && list.issues.length > 0 ? <ReadIssues issues={list.issues} /> : null}
        {toolbarActions}
      </div>

      {/* The scrollbar floats over the list, so a list that grows or shrinks never moves a line. */}
      <ScrollArea
        className={cn(
          "min-h-0 [&>[data-slot=scroll-area-viewport]]:overscroll-contain",
          listClassName,
        )}
      >
        <div ref={listRef} onKeyDown={onListKeyDown} className="flex flex-col">
          {failedRead ? (
            <ReadFailure error={query.error} hasList={list !== undefined} onRetry={retry} />
          ) : null}
          {query.isPending && !failedRead ? <ListSkeleton /> : null}
          {/* Search results change with each key, so they show at once. A refresh still animates. */}
          <CssPresenceList instant={filtering || settling}>
            {views.map((entry) => (
              <ProcessGroupSection
                key={entry.group.checkoutPath}
                view={entry}
                filter={filter}
                enterUrl={enterUrl}
                focused={rankOf(entry) === 0}
                // Other workspaces start folded. A filter opens every checkout.
                initiallyOpen={rankOf(entry) < 2}
                stoppingRefs={stops.stoppingRefs}
                isRowOutdated={isRowOutdated}
                onOpenUrl={openUrl}
                onStop={(group, rows, label) => {
                  // The command folds away when it stops, so the filter takes the focus.
                  filterRef.current?.focus();
                  void stops.stop(group, rows, label);
                }}
              />
            ))}
          </CssPresenceList>
          <EmptyStates
            list={list}
            filter={filter}
            hasProcesses={allViews.length > 0}
            hasMatches={views.length > 0}
            onClearFilter={() => changeFilter("")}
          />
        </div>
      </ScrollArea>
    </div>
  );
});

/** A dot that tells the list reads the processes again on its own, or that the read failed. */
function LiveStatus({ failed }: { failed: boolean }): ReactElement {
  const label = failed
    ? "The last read failed."
    : `Live. The list reads the processes again every ${LIVE_REFRESH_MS / 1000} seconds.`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        failed ? "bg-destructive" : "bg-status-running",
      )}
    />
  );
}

/** The counts beside the title. */
function ProcessSummary({
  views,
  matches,
}: {
  views: readonly ProcessGroupView[];
  /** The views that the filter shows, or null without a filter. */
  matches: readonly ProcessGroupView[] | null;
}) {
  const totals = processTotals(views);
  if (totals.commands === 0) return null;
  if (matches)
    return (
      <span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">
        {processTotals(matches).commands} of {countLabel(totals.commands, "command", "commands")}
      </span>
    );
  return (
    <span
      className="min-w-0 truncate text-xs text-muted-foreground tabular-nums"
      title={countLabel(totals.processes, "process", "processes")}
    >
      {countLabel(totals.commands, "command", "commands")}
      {totals.ports > 0 ? ` · ${countLabel(totals.ports, "port", "ports")}` : null}
    </span>
  );
}

/** The skeleton of the first read. It has the shape of a checkout and its commands. */
function ListSkeleton(): ReactElement {
  return (
    <div role="status" aria-label="Reading processes" className="flex flex-col">
      {[3, 2].map((rows, group) => (
        <div key={group} className="flex flex-col">
          <div className="flex h-7 items-center gap-2 border-b border-border/60 bg-muted/80 px-3">
            <Skeleton className="size-3.5" />
            <Skeleton className="h-2.5 w-36" />
          </div>
          <div className="flex flex-col pt-1">
            {Array.from({ length: rows }, (_, row) => (
              <div key={row} className="flex h-8 items-center gap-2 pr-2 pl-3">
                <Skeleton className="size-3.5" />
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="h-2.5 w-28" />
                <Skeleton className="ml-auto h-2.5 w-10" />
                <Skeleton className="size-6" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReadFailure({
  error,
  hasList,
  onRetry,
}: {
  error: Error;
  hasList: boolean;
  onRetry: () => void;
}): ReactElement {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-destructive"
    >
      <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        OpenDucktor cannot read the processes. {errorMessage(error)}
        {hasList ? " The list shows the last results." : null}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={onRetry}
      >
        Retry
      </Button>
    </div>
  );
}

/** A quiet note for a partial read. Its details open in a popover. */
function ReadIssues({ issues }: { issues: readonly WorkspaceProcessIssue[] }): ReactElement {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // The popover joins the panel, so the flyout keeps its focus and its outside clicks.
  const portalContainer = open
    ? (triggerRef.current?.closest<HTMLElement>(PROCESSES_SURFACE) ?? null)
    : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label="Some processes may be missing"
          title="Some processes may be missing"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-warning-muted transition-colors hover:bg-warning-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <TriangleAlert className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="flex w-96 flex-col gap-2 p-3 text-xs"
        portalContainer={portalContainer}
      >
        {issues.map((issue) => (
          <div key={issue.message} className="flex flex-col gap-0.5">
            <p>{issue.message}</p>
            <p className="text-muted-foreground">{issue.nextAction}</p>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** A filter without matches, and an empty list. */
function EmptyStates({
  list,
  filter,
  hasProcesses,
  hasMatches,
  onClearFilter,
}: {
  list: WorkspaceProcessList | undefined;
  filter: string;
  hasProcesses: boolean;
  hasMatches: boolean;
  onClearFilter: () => void;
}): ReactElement | null {
  if (!list) return null;
  if (hasProcesses && !hasMatches)
    return (
      <EmptyState
        icon={<SearchX className="size-4" aria-hidden="true" />}
        title={`No command matches “${filter.trim()}”`}
        instant
      >
        <Button type="button" variant="outline" size="sm" onClick={onClearFilter}>
          Clear filter
        </Button>
      </EmptyState>
    );
  if (hasProcesses) return null;
  if (list.issues.length > 0)
    return (
      <EmptyState
        icon={<TriangleAlert className="size-4" aria-hidden="true" />}
        title="No processes found"
        description="Some checkouts could not be read."
      />
    );
  return (
    <EmptyState
      icon={<Cpu className="size-4" aria-hidden="true" />}
      title="No running processes"
      description="Nothing runs in your checkouts. A command that you start shows here."
    />
  );
}

function EmptyState({
  icon,
  title,
  description,
  instant = false,
  children,
}: {
  icon?: ReactElement;
  title: string;
  description?: string;
  /** True for a state that each key of the filter can show, so it shows at once. */
  instant?: boolean;
  children?: ReactElement;
}): ReactElement {
  return (
    <div
      className={cn(
        "flex min-h-56 flex-col items-center justify-center gap-3 px-6 py-8 text-center",
        !instant && "process-empty-enter",
      )}
    >
      {icon ? (
        <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </span>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? (
          <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children ? <div className="flex flex-wrap justify-center gap-2">{children}</div> : null}
    </div>
  );
}
