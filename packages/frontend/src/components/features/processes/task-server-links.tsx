import type { WorkspaceProcessList } from "@openducktor/contracts";
import { type ReactElement, useCallback } from "react";
import { useProcessList, useProcessesActions } from "./processes-context";
import { PortsPopover } from "./ports-popover";
import { type TaskServerLink, taskServerLinks } from "./processes-view";

const NO_LINKS: TaskServerLink[] = [];

const linkTitle = (link: TaskServerLink): string => `Open ${link.url} · ${link.name}`;

type TaskServerPortsMenuProps = {
  taskId: string | null;
  className?: string;
};

/**
 * The web ports of a task as one small button with their count, for a header with little space.
 * The button opens a list of the ports, and each one opens its URL. Nothing shows without a port.
 */
export function TaskServerPortsMenu({
  taskId,
  className,
}: TaskServerPortsMenuProps): ReactElement | null {
  const target = useTaskPortsTarget(taskId);
  return target ? <ServerPortsMenu target={target} className={className} /> : null;
}

/** The task whose ports show, and the action that opens a port. */
type PortsTarget = { workspaceId: string; taskId: string; openUrl: (url: string) => void };

/** Null for a remote host, outside the app shell, or without a task. */
function useTaskPortsTarget(taskId: string | null): PortsTarget | null {
  const actions = useProcessesActions();
  const workspaceId = actions?.activeWorkspaceId ?? null;
  // Outside the app shell, such as in a test of a header, no list exists to read.
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
