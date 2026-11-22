import type { WorkspaceProcessList } from "@openducktor/contracts";
import { ArrowUpRight } from "lucide-react";
import { type ReactElement, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useProcessList, useProcessesActions } from "./processes-context";
import { PortsPopover } from "./ports-popover";
import { type TaskServerLink, taskServerLinks } from "./processes-view";

const NO_LINKS: TaskServerLink[] = [];

const linkTitle = (link: TaskServerLink): string => `Open ${link.url} · ${link.name}`;

type TaskServerLinksProps = {
  taskId: string | null;
  className?: string;
};

/**
 * The web ports that run in the worktrees of a task, as chips that open them. A card or a sheet
 * shows where the dev server of a task runs, without a click on the rail. The task belongs to
 * the active workspace. Nothing shows for a remote host or a task without a web port.
 */
export function TaskServerLinks({ taskId, className }: TaskServerLinksProps): ReactElement | null {
  const target = useTaskPortsTarget(taskId);
  return target ? <ServerLinkChips target={target} className={className} /> : null;
}

/**
 * The web ports of a task as one small button with their count, for a header with little space.
 * The button opens a list of the ports, and each one opens its URL. Nothing shows without a port.
 */
export function TaskServerPortsMenu({
  taskId,
  className,
}: TaskServerLinksProps): ReactElement | null {
  const target = useTaskPortsTarget(taskId);
  return target ? <ServerPortsMenu target={target} className={className} /> : null;
}

/** The task whose ports show, and the action that opens a port. */
type PortsTarget = { workspaceId: string; taskId: string; openUrl: (url: string) => void };

/** Null for a remote host, outside the app shell, or without a task. */
function useTaskPortsTarget(taskId: string | null): PortsTarget | null {
  const actions = useProcessesActions();
  const workspaceId = actions?.activeWorkspaceId ?? null;
  // Outside the app shell, such as in a test of a card, no list exists to read.
  if (!actions || !workspaceId || !taskId) return null;
  return { workspaceId, taskId, openUrl: actions.openUrl };
}

function useTaskServerLinks({ workspaceId, taskId }: PortsTarget): readonly TaskServerLink[] {
  const select = useCallback(
    (list: WorkspaceProcessList) => taskServerLinks(list, workspaceId, taskId),
    [workspaceId, taskId],
  );
  const { data: links = NO_LINKS } = useProcessList(select);
  return links;
}

function ServerLinkChips({
  target,
  className,
}: {
  target: PortsTarget;
  className: string | undefined;
}): ReactElement | null {
  const links = useTaskServerLinks(target);
  if (links.length === 0) return null;
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
      {links.map((link) => (
        <button
          key={link.url}
          type="button"
          className="group/chip inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-full border border-border px-2 font-mono text-[11px] leading-none text-status-running-foreground transition-colors hover:border-info-border hover:bg-info-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          title={linkTitle(link)}
          aria-label={linkTitle(link)}
          // A card opens its task on a click, so the chip keeps the click.
          onClick={(event) => {
            event.stopPropagation();
            target.openUrl(link.url);
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

function ServerPortsMenu({
  target,
  className,
}: {
  target: PortsTarget;
  className: string | undefined;
}): ReactElement | null {
  const links = useTaskServerLinks(target);
  return (
    <PortsPopover
      items={links.map((link) => ({
        key: link.url,
        port: link.port,
        detail: link.name,
        url: link.url,
        title: linkTitle(link),
      }))}
      listLabel="Ports of this task"
      className={className}
      onOpenUrl={target.openUrl}
    />
  );
}
