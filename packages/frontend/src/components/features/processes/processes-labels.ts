import type { WorkspaceProcessGroup, WorkspaceProcessListener } from "@openducktor/contracts";
import { basenameForPath } from "@openducktor/path-support";

/** The address and port of a listener. An IPv6 address gets brackets. */
export const listenerLabel = (listener: WorkspaceProcessListener): string => {
  const host = listener.address.includes(":") ? `[${listener.address}]` : listener.address;
  return `${host}:${listener.port}`;
};

/** The title of a group: its task or session names, or the repository checkout. */
export const groupTitle = (group: WorkspaceProcessGroup): string => {
  const titles = [...new Set(group.owners.map((owner) => owner.title))];
  if (titles.length > 0) return titles.join(", ");
  return group.kind === "repository"
    ? group.workspaceName
    : basenameForPath(group.checkoutPath) || group.checkoutPath;
};

/**
 * What tells a worktree apart from another with the same title: the IDs of its tasks, else its
 * workspace. A repository checkout has the workspace as its title.
 */
export const groupSubtitle = (
  group: WorkspaceProcessGroup,
): { text: string; taskIds: boolean } | null => {
  if (group.kind === "repository") return null;
  const taskIds = group.owners.flatMap((owner) => (owner.kind === "task" ? [owner.taskId] : []));
  return taskIds.length > 0
    ? { text: taskIds.join(", "), taskIds: true }
    : { text: group.workspaceName, taskIds: false };
};

export const countLabel = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;
