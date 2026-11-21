import type { WorkspaceProcessList } from "@openducktor/contracts";
import { ArrowUpRight } from "lucide-react";
import { type ReactElement, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useProcessList, useProcessesActions } from "./processes-context";
import { type TaskServerLink, taskServerLinks } from "./processes-view";

const NO_LINKS: TaskServerLink[] = [];

/**
 * The web ports that run in the worktrees of a task, as chips that open them. A card or a header
 * shows where the dev server of a task runs, without a click on the rail. The task belongs to
 * the active workspace. Nothing shows for a remote host or a task without a web port.
 */
export function TaskServerLinks({
  taskId,
  className,
}: {
  taskId: string | null;
  className?: string;
}): ReactElement | null {
  const actions = useProcessesActions();
  const workspaceId = actions?.activeWorkspaceId ?? null;
  // Outside the app shell, such as in a test of a card, no list exists to read.
  if (!actions || !workspaceId || !taskId) return null;
  return (
    <ServerLinks
      workspaceId={workspaceId}
      taskId={taskId}
      onOpenUrl={actions.openUrl}
      className={className}
    />
  );
}

function ServerLinks({
  workspaceId,
  taskId,
  onOpenUrl,
  className,
}: {
  workspaceId: string;
  taskId: string;
  onOpenUrl: (url: string) => void;
  className: string | undefined;
}): ReactElement | null {
  const select = useCallback(
    (list: WorkspaceProcessList) => taskServerLinks(list, workspaceId, taskId),
    [workspaceId, taskId],
  );
  const { data: links = NO_LINKS } = useProcessList(select);
  if (links.length === 0) return null;
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
      {links.map((link) => (
        <button
          key={link.url}
          type="button"
          className="group/chip inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-full border border-border px-2 font-mono text-[11px] leading-none text-status-running-foreground transition-colors hover:border-info-border hover:bg-info-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          title={link.title}
          aria-label={link.title}
          // A card opens its task on a click, so the chip keeps the click.
          onClick={(event) => {
            event.stopPropagation();
            onOpenUrl(link.url);
          }}
        >
          <span className="size-1.5 rounded-full bg-status-running" aria-hidden="true" />:
          {link.port}
          <ArrowUpRight
            className="-ml-0.5 size-3 text-muted-foreground transition-colors group-hover/chip:text-status-running-foreground"
            aria-hidden="true"
          />
        </button>
      ))}
    </span>
  );
}
