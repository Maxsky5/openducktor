import type { WorkspaceProcessListener, WorkspaceProcessRow } from "@openducktor/contracts";
import { Square, TriangleAlert } from "lucide-react";
import { type ReactElement, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { PROCESSES_SURFACE } from "./processes-context";
import { countLabel, listenerLabel } from "./processes-labels";

/** Addresses that this machine reaches, so the port alone names them. */
const LOCAL_ADDRESSES = new Set(["127.0.0.1", "::1", "localhost", "0.0.0.0", "::"]);

const PID_REUSE_WARNING =
  "If a process exits after the final check and the system reuses its ID, Stop could affect a different process.";

type ProcessStopPopoverProps = {
  /** The processes that stop together. Only the ones that may stop get the request. */
  rows: readonly WorkspaceProcessRow[];
  label: string;
  /** The folder of the command below the checkout. */
  directory?: string | undefined;
  listeners: readonly WorkspaceProcessListener[];
  stopping: boolean;
  disabled: boolean;
  /** A smaller button that shows only on hover, for one process in the details of a command. */
  compact?: boolean;
  onConfirm: () => void;
};

/** What a stop of the rows does: the rows that stop, the rows that keep running, and the risks. */
const stopSummary = (rows: readonly WorkspaceProcessRow[]) => {
  const stoppable = rows.filter((row) => row.stop.allowed);
  return {
    stoppable: stoppable.length,
    skipped: rows.length - stoppable.length,
    forced: stoppable.some((row) => row.stop.allowed && row.stop.forced),
    pidOnly: stoppable.some((row) => row.stop.allowed && row.stop.requiresPidReuseAcknowledgment),
  };
};

/**
 * The facts that identify what stops: the folder, the PID or the process count, and the ports.
 * Only an address outside this machine is named. Paths and ports are code.
 */
const stopFacts = (
  rows: readonly WorkspaceProcessRow[],
  stoppable: number,
  directory: string | undefined,
  listeners: readonly WorkspaceProcessListener[],
): { text: string; code: boolean }[] => [
  ...(directory ? [{ text: directory, code: true }] : []),
  {
    text: rows.length === 1 ? `PID ${rows[0]?.pid}` : countLabel(stoppable, "process", "processes"),
    code: false,
  },
  ...listeners.map((listener) => ({
    text: LOCAL_ADDRESSES.has(listener.address) ? `:${listener.port}` : listenerLabel(listener),
    code: true,
  })),
];

/** The notes under the confirmation: the processes that keep running, and the stop risks. */
function StopNotes({
  skipped,
  forced,
  pidOnly,
}: Omit<ReturnType<typeof stopSummary>, "stoppable">): ReactElement {
  return (
    <>
      {skipped > 0 ? (
        <p role="note" className="text-xs text-muted-foreground">
          {countLabel(skipped, "process keeps", "processes keep")} running, because OpenDucktor
          cannot stop {skipped === 1 ? "it" : "them"}.
        </p>
      ) : null}
      {forced ? (
        <p role="note" className="flex gap-2 text-xs text-warning-muted">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          The system ends each process at once, so it cannot save its work.
        </p>
      ) : null}
      {pidOnly ? (
        <p role="note" className="flex gap-2 text-xs text-warning-muted">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {PID_REUSE_WARNING}
        </p>
      ) : null}
    </>
  );
}

/**
 * The stop button of a command or a process. It asks for confirmation beside the button, with the
 * facts that identify what stops, so a stop takes two clicks at the same place.
 */
export function ProcessStopPopover({
  rows,
  label,
  directory,
  listeners,
  stopping,
  disabled,
  compact = false,
  onConfirm,
}: ProcessStopPopoverProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  // A confirmed stop removes this button, so the dialog decides where the focus goes.
  const confirmedRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [first] = rows;
  if (!first) return null;
  const { stoppable, ...notes } = stopSummary(rows);
  const blocked = stoppable === 0 && !first.stop.allowed ? first.stop.issue : null;
  const facts = stopFacts(rows, stoppable, directory, listeners);
  const stopLabel = rows.length === 1 ? `Stop ${label} (PID ${first.pid})` : `Stop ${label}`;
  // The popover joins the list, so the flyout keeps its focus and its outside clicks.
  const portalContainer = open
    ? (triggerRef.current?.closest<HTMLElement>(PROCESSES_SURFACE) ?? null)
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className={cn(
            // A filled square on a soft key, as a media player shows Stop.
            "flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-[color,background-color,opacity] duration-150 hover:bg-destructive/15 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 data-[state=open]:bg-destructive/15 data-[state=open]:text-destructive",
            compact
              ? "opacity-0 group-hover/member:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
              : "group-hover/command:text-foreground",
          )}
          aria-label={stopLabel}
          title={blocked ? blocked.message : stopLabel}
          disabled={disabled || stopping || blocked !== null}
        >
          <Square className="size-2.5 fill-current" strokeWidth={0} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        portalContainer={portalContainer}
        // Beside the button, so the popover covers no other line.
        side="left"
        align="center"
        sideOffset={8}
        className="flex w-80 flex-col gap-2 p-3"
        role="dialog"
        onCloseAutoFocus={(event) => {
          if (confirmedRef.current) event.preventDefault();
          confirmedRef.current = false;
        }}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p id={titleId} className="truncate text-sm font-medium" title={label}>
              Stop <span className="font-mono text-xs">{label}</span>?
            </p>
            <p id={descriptionId} className="text-xs break-words text-muted-foreground">
              {facts.map((fact, index) => (
                <span key={fact.text}>
                  {index > 0 ? " · " : null}
                  <span className={cn(fact.code && "font-mono text-[11px]")}>{fact.text}</span>
                </span>
              ))}
            </p>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-7 shrink-0 px-3 text-xs"
            autoFocus
            title="Sends a quit signal to each process."
            onClick={() => {
              confirmedRef.current = true;
              setOpen(false);
              onConfirm();
            }}
          >
            Stop
          </Button>
        </div>
        <StopNotes {...notes} />
      </PopoverContent>
    </Popover>
  );
}
