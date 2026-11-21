import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { plural } from "@openducktor/frontend-core/lib/plural";
import { workflowVersionsQueryOptions } from "@openducktor/frontend-core/queries/workflow-library";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { type ReactElement, type ReactNode, useState } from "react";
import { useNavigate } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { workflowPath, workflowVersionPath } from "../workflow-routes";
import { STATUS_PILL_CLASS, StatusMark, type StatusText } from "../workflow-status";
import { publishedAtText } from "./published-at";

function MenuHeading({ children }: { children: string }): ReactElement {
  return (
    <p className="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </p>
  );
}

function VersionItem({
  title,
  badge,
  detail,
  current,
  mark,
  onSelect,
}: {
  title: string;
  badge?: string;
  detail: string;
  current: boolean;
  mark: ReactNode;
  onSelect: () => void;
}): ReactElement {
  return (
    <DropdownMenuItem
      // A long list opens at the entry that the editor shows.
      ref={current ? (node) => node?.scrollIntoView({ block: "nearest" }) : undefined}
      className="items-start gap-2.5 rounded-md px-2.5 py-2 focus:bg-accent/60"
      aria-current={current ? "page" : undefined}
      onSelect={onSelect}
    >
      <span className="mt-1.5 flex size-3 shrink-0 items-center justify-center text-muted-foreground">
        {mark}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {title}
          {badge ? (
            <span className="rounded-full bg-emerald-500/12 px-1.5 py-px text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      {current ? <Check aria-hidden="true" className="mt-1 size-4 shrink-0" /> : null}
    </DropdownMenuItem>
  );
}

/**
 * The status of the open workflow as a menu button. The menu opens the editable workflow, with its
 * draft if it has one, or one published version, read-only.
 */
export function VersionSwitcher({
  workflowId,
  status,
  routeVersion,
  latestVersion,
  hasDraft,
}: {
  workflowId: string;
  status: StatusText;
  /** The open version, or null in the editable workflow. */
  routeVersion: number | null;
  latestVersion: number;
  /** Whether the workflow has unpublished changes. */
  hasDraft: boolean;
}): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const versionsOptions = workflowVersionsQueryOptions(workflowId);
  const versions = useQuery({ ...versionsOptions, enabled: open });
  const sorted = (versions.data ?? []).toSorted((left, right) => right.version - left.version);
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${status.label}. Open another version`}
          className={cn(
            STATUS_PILL_CLASS,
            "cursor-pointer pr-2 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
          )}
          // The menu lists the versions at once when the pointer reached the button first.
          onPointerEnter={() => void queryClient.prefetchQuery(versionsOptions)}
        >
          <StatusMark tone={status.tone} />
          <span className="truncate">{status.label}</span>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        // A height from the window, not from the menu position, so the list scrolls from its first render.
        className="max-h-[min(28rem,calc(100dvh-6rem))] w-80 overflow-y-auto p-1"
      >
        <MenuHeading>Editable</MenuHeading>
        <VersionItem
          title={hasDraft ? "Draft" : "Current workflow"}
          detail={
            hasDraft
              ? "Unpublished changes"
              : `Same as version ${latestVersion}. A change starts a draft.`
          }
          current={routeVersion === null}
          mark={<StatusMark tone={hasDraft ? "draft" : "published"} />}
          onSelect={() => navigate(workflowPath(workflowId))}
        />
        <DropdownMenuSeparator />
        <MenuHeading>Published versions</MenuHeading>
        {versions.isPending ? (
          <p className="px-2.5 py-2 text-xs text-muted-foreground">Reading the versions…</p>
        ) : null}
        {versions.isError ? (
          <p role="alert" className="px-2.5 py-2 text-xs text-destructive-muted">
            The versions could not load. {errorMessage(versions.error)}
          </p>
        ) : null}
        {sorted.map((version) => (
          <VersionItem
            key={version.version}
            title={`Version ${version.version}`}
            {...(version.version === latestVersion ? { badge: "Latest" } : {})}
            detail={`${publishedAtText(version.publishedAt)} · ${plural(version.taskCount, "task")}`}
            current={routeVersion === version.version}
            mark={<StatusMark tone="locked" />}
            onSelect={() => navigate(workflowVersionPath(workflowId, version.version))}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
