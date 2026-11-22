import type { WorkspaceProcessListener, WorkspaceProcessRow } from "@openducktor/contracts";
import { AppWindow, Check, ChevronRight, Copy, Loader2, TriangleAlert } from "lucide-react";
import { type KeyboardEvent, type ReactElement, useId, useState } from "react";
import { useCssPresence } from "@/components/ui/css-presence";
import { CssPresenceReveal } from "@/components/ui/css-presence-reveal";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { cn } from "@/lib/utils";
import { PortsPopover } from "./ports-popover";
import { ProcessStopPopover } from "./process-stop-popover";
import { countLabel, listenerLabel } from "./processes-labels";
import {
  commandTitle,
  filterTerms,
  linkOf,
  type ProcessAppView,
  type ProcessCommandView,
  type ProcessMember,
  readableCommand,
  type TreeGuide,
} from "./processes-view";

/** A command shows this many ports. The title of the rest names them. */
const VISIBLE_PORTS = 3;

type ProcessCommandRowProps = {
  command: ProcessCommandView;
  checkoutPath: string;
  /** The filter text, which the command and its processes mark. */
  filter: string;
  stoppingRefs: ReadonlySet<string>;
  isRowOutdated: (row: WorkspaceProcessRow) => boolean;
  /** True for the command whose URL Enter in the filter opens. */
  enterTarget: boolean;
  onOpenUrl: (url: string) => void;
  onStop: (rows: readonly WorkspaceProcessRow[], label: string) => void;
};

/**
 * One command on one line, as a terminal prompt shows it: its folder, the command, its ports, and
 * Stop, which stops the command with every process that it started. The line opens the details
 * with each process, its PID, and its full command.
 */
export function ProcessCommandRow({
  command,
  checkoutPath,
  filter,
  stoppingRefs,
  isRowOutdated,
  enterTarget,
  onOpenUrl,
  onStop,
}: ProcessCommandRowProps): ReactElement {
  const { presenceProps } = useCssPresence();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const { root, members, listeners } = command;
  // A filter that matches only a process below the command shows that process.
  const open = expanded || command.matchedBelow;
  const label = commandTitle(command, checkoutPath);
  const stopping = members.some((member) => stoppingRefs.has(member.row.processRef));
  const outdated = isRowOutdated(root);
  const rows = members.map((member) => member.row);
  return (
    <li
      {...presenceProps}
      className="css-presence process-presence"
      aria-busy={stopping || undefined}
      aria-label={root.directory ? `${label} in ${root.directory}` : label}
    >
      <div
        className={cn(
          "group/command @container/row flex h-8 items-center gap-3 pr-2 transition-[background-color,opacity] duration-150 hover:bg-accent/40 has-[[data-state=open]]:bg-accent/40",
          enterTarget && "bg-accent/40",
          (outdated || stopping) && "opacity-50",
        )}
      >
        <button
          type="button"
          // A command sits below its checkout: its chevron lines up with the checkout icon.
          className="flex h-full min-w-0 flex-1 items-center gap-2 pl-[34px] text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
          aria-expanded={open}
          aria-controls={detailsId}
          title={root.command}
          data-process-command=""
          onClick={() => setExpanded(!open)}
          onKeyDown={(event) => toggleWithArrows(event, open, setExpanded)}
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200 ease-(--motion-ease-out) group-hover/command:text-muted-foreground",
              open && "rotate-90",
            )}
            aria-hidden="true"
          />
          <span className="flex min-w-0 items-baseline gap-1.5 overflow-hidden font-mono text-xs">
            {root.directory ? (
              <>
                <span className="max-w-48 min-w-0 truncate text-muted-foreground">
                  {root.directory}
                </span>
                <span className="shrink-0 text-muted-foreground/60" aria-hidden="true">
                  $
                </span>
              </>
            ) : null}
            <span className="min-w-0 truncate text-foreground">
              <Highlighted text={label} query={filter} />
            </span>
            {enterTarget ? (
              <kbd
                className="shrink-0 self-center rounded-sm border border-border bg-muted px-1 font-sans text-[10px] leading-4 text-muted-foreground"
                title="Enter opens the first port"
                aria-hidden="true"
              >
                ↵
              </kbd>
            ) : null}
          </span>
        </button>
        {stopping ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Stopping…
          </span>
        ) : (
          <PortLinks
            listeners={listeners}
            disabled={outdated}
            listLabel={`Ports of ${label}`}
            onOpenUrl={onOpenUrl}
          />
        )}
        {outdated && !stopping ? (
          <span className="shrink-0 text-xs text-muted-foreground">Out of date</span>
        ) : null}
        <ProcessStopPopover
          rows={rows}
          label={label}
          directory={root.directory}
          listeners={listeners}
          stopping={stopping}
          disabled={stopping || outdated}
          onConfirm={() => onStop(rows, label)}
        />
      </div>
      <MemberList
        id={detailsId}
        label={`Processes of ${label}`}
        open={open}
        members={members}
        checkoutPath={checkoutPath}
        stoppingRefs={stoppingRefs}
        isRowOutdated={isRowOutdated}
        filter={filter}
        // A command of one process stops with the Stop of the command.
        stoppable={members.length > 1}
        quietRoot
        onOpenUrl={onOpenUrl}
        onStop={onStop}
      />
    </li>
  );
}

type ProcessAppRowProps = Omit<ProcessCommandRowProps, "command" | "enterTarget"> & {
  app: ProcessAppView;
};

/**
 * The processes that another app, such as an editor, started in the checkout without a shell. They
 * fold behind one quiet line, and each one stops alone.
 */
export function ProcessAppRow({
  app,
  checkoutPath,
  filter,
  stoppingRefs,
  isRowOutdated,
  onOpenUrl,
  onStop,
}: ProcessAppRowProps): ReactElement {
  const { presenceProps } = useCssPresence();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const open = expanded || app.matchedBelow;
  const label = `Processes that ${app.name} started`;
  return (
    <li {...presenceProps} className="css-presence process-presence" aria-label={label}>
      <div className="group/command @container/row flex h-8 items-center gap-3 pr-2 transition-colors duration-150 hover:bg-accent/40">
        <button
          type="button"
          className="flex h-full min-w-0 flex-1 items-center gap-2 pl-[34px] text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
          aria-expanded={open}
          aria-controls={detailsId}
          title={`${app.name} started these processes in this checkout.`}
          data-process-command=""
          onClick={() => setExpanded(!open)}
          onKeyDown={(event) => toggleWithArrows(event, open, setExpanded)}
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200 ease-(--motion-ease-out) group-hover/command:text-muted-foreground",
              open && "rotate-90",
            )}
            aria-hidden="true"
          />
          <AppWindow className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 truncate text-xs text-foreground/90">
            {app.name}
            <span className="text-muted-foreground">
              {" · "}
              {countLabel(app.members.length, "process", "processes")}
            </span>
          </span>
        </button>
        <PortLinks
          listeners={app.listeners}
          disabled={false}
          listLabel={`Ports of ${app.name}`}
          onOpenUrl={onOpenUrl}
        />
        {/* The processes of an app stop one by one, so this line has no Stop. */}
        <span className="w-6 shrink-0" />
      </div>
      <MemberList
        id={detailsId}
        label={label}
        open={open}
        members={app.members}
        checkoutPath={checkoutPath}
        stoppingRefs={stoppingRefs}
        isRowOutdated={isRowOutdated}
        filter={filter}
        stoppable
        onOpenUrl={onOpenUrl}
        onStop={onStop}
      />
    </li>
  );
}

/** ArrowRight opens a line and ArrowLeft closes it, as in a tree. */
const toggleWithArrows = (
  event: KeyboardEvent<HTMLButtonElement>,
  open: boolean,
  setExpanded: (expanded: boolean) => void,
) => {
  if (event.key === "ArrowRight" && !open) setExpanded(true);
  else if (event.key === "ArrowLeft" && open) setExpanded(false);
  else return;
  event.preventDefault();
};

/** The processes of a command or an app, each below the process that started it. */
function MemberList({
  id,
  label,
  open,
  members,
  checkoutPath,
  stoppingRefs,
  isRowOutdated,
  filter,
  stoppable,
  quietRoot = false,
  onOpenUrl,
  onStop,
}: {
  id: string;
  label: string;
  open: boolean;
  members: readonly ProcessMember[];
  checkoutPath: string;
  stoppingRefs: ReadonlySet<string>;
  isRowOutdated: (row: WorkspaceProcessRow) => boolean;
  filter: string;
  stoppable: boolean;
  /** True when the line above shows the first process, so its detail line stays quiet. */
  quietRoot?: boolean;
  onOpenUrl: (url: string) => void;
  onStop: (rows: readonly WorkspaceProcessRow[], label: string) => void;
}): ReactElement {
  return (
    <CssPresenceReveal open={open}>
      <ul id={id} aria-label={label} className="flex flex-col bg-muted/25 py-1">
        {members.map((member) => (
          <ProcessMemberLine
            key={member.row.processRef}
            member={member}
            checkoutPath={checkoutPath}
            stopping={stoppingRefs.has(member.row.processRef)}
            outdated={isRowOutdated(member.row)}
            filter={filter}
            stoppable={stoppable}
            quiet={quietRoot && member.depth === 0}
            onOpenUrl={onOpenUrl}
            onStop={onStop}
          />
        ))}
      </ul>
    </CssPresenceReveal>
  );
}

/** One process in the details of a command: its PID, its command below its parent, and its ports. */
function ProcessMemberLine({
  member: { row, guides, matched },
  checkoutPath,
  stopping,
  outdated,
  filter,
  stoppable,
  quiet,
  onOpenUrl,
  onStop,
}: {
  member: ProcessMember;
  checkoutPath: string;
  stopping: boolean;
  outdated: boolean;
  filter: string;
  stoppable: boolean;
  quiet: boolean;
  onOpenUrl: (url: string) => void;
  onStop: (rows: readonly WorkspaceProcessRow[], label: string) => void;
}): ReactElement {
  const { copied, copyToClipboard } = useCopyToClipboard({ successMessage: "URL copied" });
  const url = linkOf(row.listeners[0]);
  const notes = [row.listenerIssue?.message, row.stop.allowed ? null : row.stop.issue.message]
    .filter(Boolean)
    .join(" ");
  const command = readableCommand(row, checkoutPath);
  return (
    <li
      className={cn(
        "group/member @container/row flex h-6 items-center gap-3 pr-2 pl-[44px] hover:bg-accent/40 has-[[data-state=open]]:bg-accent/40",
        (stopping || outdated) && "opacity-50",
      )}
      aria-label={`${row.name}, PID ${row.pid}`}
    >
      {/* The PIDs end where the folders of the commands start. */}
      <span className="w-[6ch] shrink-0 text-right font-mono text-[11px] text-muted-foreground/80 tabular-nums">
        {row.pid}
      </span>
      <span className="flex h-full min-w-0 flex-1 items-center">
        {guides.map((column) => (
          <TreeGuideCell key={column.owner} guide={column.guide} />
        ))}
        <span
          className={cn(
            "min-w-0 truncate font-mono text-[11px]",
            guides.length > 0 && "pl-1",
            matched && "text-foreground",
            !matched && (quiet ? "text-muted-foreground" : "text-foreground/70"),
          )}
          title={row.command}
        >
          <Highlighted text={command} query={filter} />
        </span>
      </span>
      {notes ? (
        <span className="flex shrink-0 text-warning-muted" title={notes}>
          <TriangleAlert className="size-3" aria-hidden="true" />
          <span className="sr-only">{notes}</span>
        </span>
      ) : null}
      {url ? (
        <button
          type="button"
          className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity group-hover/member:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:opacity-100 @max-[24rem]/row:hidden"
          aria-label={`Copy ${url}`}
          title={`Copy ${url}`}
          onClick={() => void copyToClipboard(url)}
        >
          {copied ? (
            <Check className="size-3 text-success-icon" aria-hidden="true" />
          ) : (
            <Copy className="size-3" aria-hidden="true" />
          )}
        </button>
      ) : null}
      <PortLinks
        listeners={row.listeners}
        disabled={stopping || outdated}
        small
        listLabel={`Ports of ${command}`}
        onOpenUrl={onOpenUrl}
      />
      {/* The slot has the width of the Stop of a command, so the ports line up. */}
      <span className="flex w-6 shrink-0 justify-center">
        {stoppable ? (
          <ProcessStopPopover
            rows={[row]}
            label={command}
            listeners={row.listeners}
            stopping={stopping}
            disabled={stopping || outdated}
            compact
            onConfirm={() => onStop([row], command)}
          />
        ) : null}
      </span>
    </li>
  );
}

/** One cell of the tree lines, as tall as the line, so the lines of the cells join. */
function TreeGuideCell({ guide }: { guide: TreeGuide }): ReactElement {
  return (
    <span className="relative h-full w-3 shrink-0" aria-hidden="true">
      {guide === "space" ? null : (
        <span
          className={cn(
            "absolute left-1 w-px bg-border",
            guide === "last" ? "top-0 h-1/2" : "inset-y-0",
          )}
        />
      )}
      {guide === "branch" || guide === "last" ? (
        <span className="absolute top-1/2 right-0 left-1 h-px bg-border" />
      ) : null}
    </span>
  );
}

/** The text with each word of the filter marked where it occurs. */
function Highlighted({ text, query }: { text: string; query: string }): ReactElement {
  const terms = filterTerms(query);
  if (terms.length === 0) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: ReactElement[] = [];
  let from = 0;
  while (from < text.length) {
    // The nearest match wins, and the longer word wins at the same place.
    let start = -1;
    let length = 0;
    for (const term of terms) {
      const at = lower.indexOf(term, from);
      if (at !== -1 && (start === -1 || at < start || (at === start && term.length > length))) {
        start = at;
        length = term.length;
      }
    }
    if (start === -1) break;
    parts.push(<span key={`text-${from}`}>{text.slice(from, start)}</span>);
    parts.push(
      <mark
        key={`match-${start}`}
        className="rounded-[2px] bg-primary/25 text-inherit dark:bg-primary/45"
      >
        {text.slice(start, start + length)}
      </mark>,
    );
    from = start + length;
  }
  parts.push(<span key="rest">{text.slice(from)}</span>);
  return <>{parts}</>;
}

/**
 * The ports of a command as links that open their URLs. A port without a web page is text. A
 * narrow row folds the ports into one button with their count, so Stop after them stays in view.
 */
function PortLinks({
  listeners,
  disabled,
  small = false,
  listLabel,
  onOpenUrl,
}: {
  listeners: readonly WorkspaceProcessListener[];
  disabled: boolean;
  /** The size of the details, where the text is 11px. */
  small?: boolean;
  /** The name of the folded list. */
  listLabel: string;
  onOpenUrl: (url: string) => void;
}): ReactElement | null {
  if (listeners.length === 0) return null;
  const shown = listeners.slice(0, VISIBLE_PORTS);
  const rest = listeners.slice(VISIBLE_PORTS);
  return (
    <>
      <PortsPopover
        items={listeners.map((listener) => ({
          key: `${listener.address}:${listener.port}`,
          port: listener.port,
          detail: listenerLabel(listener),
          url: linkOf(listener),
          title: portTitle(listener),
        }))}
        listLabel={listLabel}
        disabled={disabled}
        compact
        className={cn("hidden @max-[24rem]/row:inline-flex", small && "h-5")}
        onOpenUrl={onOpenUrl}
      />
      <span
        className={cn(
          "flex shrink-0 items-center gap-2 font-mono tabular-nums @max-[24rem]/row:hidden",
          small ? "text-[11px]" : "text-xs",
        )}
      >
        {shown.map((listener) => (
          <PortLink
            key={`${listener.address}:${listener.port}`}
            listener={listener}
            disabled={disabled}
            onOpenUrl={onOpenUrl}
          />
        ))}
        {rest.length > 0 ? (
          <span className="text-muted-foreground" title={rest.map(listenerLabel).join(", ")}>
            +{rest.length}
          </span>
        ) : null}
      </span>
    </>
  );
}

/** What a port link says about the URL that it opens. */
const portTitle = (listener: WorkspaceProcessListener): string => {
  const { browser } = listener;
  if (browser.kind === "non_web") return `${listenerLabel(listener)}. Not a web server.`;
  if (browser.kind !== "link") return `${listenerLabel(listener)}. ${browser.issue.message}`;
  const notes = [
    browser.suggested ? "The protocol is unknown, so HTTP is a guess." : null,
    listener.address === "0.0.0.0" || listener.address === "::"
      ? `The process listens on all interfaces (${listenerLabel(listener)}).`
      : null,
  ].filter((note) => note !== null);
  return [`Open ${browser.url}`, ...notes].join(". ");
};

function PortLink({
  listener,
  disabled,
  onOpenUrl,
}: {
  listener: WorkspaceProcessListener;
  disabled: boolean;
  onOpenUrl: (url: string) => void;
}): ReactElement {
  const url = linkOf(listener);
  const title = portTitle(listener);
  if (!url)
    return (
      <span className="text-muted-foreground" title={title}>
        :{listener.port}
      </span>
    );
  // The title names the URL that the link opens, because a wildcard bind opens a loopback URL.
  return (
    <button
      type="button"
      className="cursor-pointer rounded-sm text-status-running-foreground underline-offset-2 transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none"
      aria-label={title}
      title={title}
      disabled={disabled}
      onClick={() => onOpenUrl(url)}
    >
      :{listener.port}
    </button>
  );
}
