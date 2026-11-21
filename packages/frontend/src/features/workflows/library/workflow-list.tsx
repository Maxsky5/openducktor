import type { WorkflowLibraryEntry } from "@openducktor/contracts";
import { workflowDocumentQueryOptions } from "@openducktor/frontend-core/queries/workflow-library";
import { useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Download,
  ExternalLink,
  Globe,
  ListChecks,
  ListX,
  Star,
  Trash2,
  Workflow,
} from "lucide-react";
import type { ReactElement } from "react";
import { Link, useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { useWorkspaceState } from "@/state";
import { ActionMenu, type MenuCommand } from "../action-menu";
import { workflowPath } from "../workflow-routes";
import { type StatusText, StatusPill, workflowStatus } from "../workflow-status";
import { StatePipeline } from "./state-pipeline";
import { availabilitySummary, availableNowhere } from "./workflow-availability";

export type WorkflowRowCommands = {
  readonly duplicate: (entry: WorkflowLibraryEntry) => void;
  readonly remove: (entry: WorkflowLibraryEntry) => void;
  readonly exportFile: (entry: WorkflowLibraryEntry) => void;
  readonly editAvailability: (entry: WorkflowLibraryEntry) => void;
  readonly setDefault: (entry: WorkflowLibraryEntry) => void;
};

/**
 * The columns of the header and of every row, so they line up. On a narrow page the name keeps
 * its room, and the status and availability columns get narrower.
 */
const GRID =
  "grid grid-cols-[minmax(14rem,1fr)_minmax(0,12rem)_minmax(0,13rem)_2.5rem] items-center gap-x-6";

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

/** What the draft check says, in the colour of its result. */
const draftReadiness = ({
  problemCount,
  warningCount,
}: NonNullable<WorkflowLibraryEntry["draft"]>) => {
  if (problemCount > 0)
    return {
      text: `${plural(problemCount, "problem")} to fix`,
      className: "text-destructive-muted",
    };
  if (warningCount > 0)
    return { text: `${warningCount} to check`, className: "text-warning-muted" };
  return { text: "Ready to publish", className: "text-muted-foreground" };
};

/** The name of a workflow and its board columns in order. */
function NameCell({
  entry,
  isDefault,
}: {
  entry: WorkflowLibraryEntry;
  isDefault: boolean;
}): ReactElement {
  const builtin = entry.source === "builtin";
  const queryClient = useQueryClient();
  // The pointer or the focus comes before the click, so the document is often there at the open.
  const prefetch = () =>
    void queryClient.prefetchQuery(workflowDocumentQueryOptions(entry.id, null));
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          builtin
            ? "bg-primary/10 text-primary-emphasis dark:bg-primary/20"
            : "bg-sky-500/12 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300",
        )}
      >
        <Workflow aria-hidden="true" className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to={workflowPath(entry.id)}
            title={`${entry.name} (${entry.id})`}
            onPointerEnter={prefetch}
            onFocus={prefetch}
            className="truncate text-sm font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
          >
            {entry.name}
          </Link>
          {builtin ? (
            <span className="shrink-0 rounded-full border border-border px-1.5 text-[11px] text-muted-foreground">
              Built-in
            </span>
          ) : null}
          {isDefault ? (
            <span
              title="New tasks use this workflow unless you pick another one."
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 text-[11px] font-medium text-primary-emphasis dark:bg-primary/20"
            >
              <Star aria-hidden="true" className="size-2.5 fill-current" />
              Default
            </span>
          ) : null}
        </div>
        <StatePipeline states={entry.states} />
      </div>
    </div>
  );
}

/** The version status, and the check result of a draft. */
function StatusCell({ entry }: { entry: WorkflowLibraryEntry }): ReactElement {
  const status: StatusText =
    entry.source === "builtin"
      ? { label: "Read-only", tone: "locked" }
      : workflowStatus({
          builtin: false,
          routeVersion: null,
          hasDraft: entry.draft !== null,
          latestVersion: entry.latestVersion,
        });
  const readiness = entry.draft ? draftReadiness(entry.draft) : null;
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <StatusPill status={status} />
      {readiness ? (
        <span className={cn("pl-1 text-xs", readiness.className)}>{readiness.text}</span>
      ) : null}
    </div>
  );
}

const AVAILABILITY_ICONS = { all: Globe, only: ListChecks, except: ListX } as const;

/** Which repositories can use the workflow. A click changes it. */
function AvailabilityCell({
  entry,
  commands,
}: {
  entry: WorkflowLibraryEntry;
  commands: WorkflowRowCommands;
}): ReactElement {
  const { workspaces } = useWorkspaceState();
  const summary = availabilitySummary(entry.availability, workspaces);
  const nowhere = availableNowhere(entry.availability, workspaces);
  const Icon = AVAILABILITY_ICONS[entry.availability.mode];
  return (
    // Above the row link, which covers the row so that a click anywhere opens the workflow.
    <button
      type="button"
      aria-label={`Availability of ${entry.name}: ${summary}. Change it`}
      title={summary}
      onClick={() => commands.editAvailability(entry)}
      className={cn(
        "relative flex min-w-0 items-center gap-1.5 justify-self-start rounded-md px-2 py-1 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        nowhere ? "text-warning-muted" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate">{summary}</span>
    </button>
  );
}

/** Open, Make default, Duplicate, and for a custom workflow Export and Delete. */
function useRowCommands(
  entry: WorkflowLibraryEntry,
  isDefault: boolean,
  duplicating: boolean,
  commands: WorkflowRowCommands,
): MenuCommand[] {
  const navigate = useNavigate();
  const custom = entry.source === "custom";
  const list: MenuCommand[] = [
    {
      label: custom ? "Open in the editor" : "View",
      Icon: ExternalLink,
      run: () => navigate(workflowPath(entry.id)),
    },
  ];
  list.push({
    label: "Change availability",
    Icon: Globe,
    run: () => commands.editAvailability(entry),
  });
  if (!isDefault) {
    const makeDefault: MenuCommand = {
      label: "Make it the default",
      Icon: Star,
      run: () => commands.setDefault(entry),
    };
    const blocked =
      custom && entry.latestVersion === null
        ? "Publish a version first."
        : entry.availability.mode !== "all"
          ? "Make it available to all repositories first."
          : null;
    list.push(blocked ? { ...makeDefault, disabled: true, reason: blocked } : makeDefault);
  }
  list.push({
    label: "Duplicate",
    Icon: Copy,
    run: () => commands.duplicate(entry),
    disabled: duplicating,
    busy: duplicating,
  });
  if (custom) {
    const unpublished = entry.latestVersion === null;
    const exportCommand: MenuCommand = {
      label: "Export as YAML",
      Icon: Download,
      run: () => commands.exportFile(entry),
      disabled: unpublished,
    };
    list.push(
      unpublished ? { ...exportCommand, reason: "Publish a version first." } : exportCommand,
    );
    list.push({
      label: "Delete",
      Icon: Trash2,
      run: () => commands.remove(entry),
      destructive: true,
    });
  }
  return list;
}

function WorkflowRow({
  entry,
  isDefault,
  duplicating,
  commands,
}: {
  entry: WorkflowLibraryEntry;
  isDefault: boolean;
  duplicating: boolean;
  commands: WorkflowRowCommands;
}): ReactElement {
  const menu = useRowCommands(entry, isDefault, duplicating, commands);
  return (
    <li className={cn(GRID, "relative px-4 py-3 transition-colors hover:bg-accent/50")}>
      <NameCell entry={entry} isDefault={isDefault} />
      <StatusCell entry={entry} />
      <AvailabilityCell entry={entry} commands={commands} />
      <div className="relative flex justify-end">
        <ActionMenu label={`Actions for ${entry.name}`} commands={menu} />
      </div>
    </li>
  );
}

/** The built-in workflow first, then the custom workflows by name, with a column header. */
export function WorkflowList({
  entries,
  defaultWorkflowId,
  duplicatingId,
  commands,
}: {
  entries: readonly WorkflowLibraryEntry[];
  /** The workflow of a new task. */
  defaultWorkflowId: string;
  /** The workflow that is being duplicated now. */
  duplicatingId: string | null;
  commands: WorkflowRowCommands;
}): ReactElement {
  const ordered = [
    ...entries.filter(({ source }) => source === "builtin"),
    ...entries
      .filter(({ source }) => source === "custom")
      .sort((left, right) => left.name.localeCompare(right.name)),
  ];
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div
        aria-hidden="true"
        className={cn(
          GRID,
          "border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground",
        )}
      >
        <span>Workflow</span>
        <span>Status</span>
        <span>Available in</span>
        <span />
      </div>
      <ul className="divide-y divide-border">
        {ordered.map((entry) => (
          <WorkflowRow
            key={entry.id}
            entry={entry}
            isDefault={entry.id === defaultWorkflowId}
            duplicating={duplicatingId === entry.id}
            commands={commands}
          />
        ))}
      </ul>
    </div>
  );
}
