import type { SidebarSessionGrouping } from "@openducktor/contracts";
import {
  type SessionNavigationTarget,
  sessionNavigationTargetKey,
} from "@/features/session-navigation/session-navigation-target";
import type {
  SessionNavigationEntry,
  SessionNavigationModel,
} from "@/state/read-models/session-navigation-read-model";

export type SessionSelection = {
  visibleKey: string | null;
  entryKey: string | null;
};

/** Grouped task selection can name another session; only the visible session counts as read. */
export const selectSessionEntry = (
  model: SessionNavigationModel,
  target: SessionNavigationTarget | null,
  grouping: SidebarSessionGrouping,
): SessionSelection => {
  const visibleKey = target ? sessionNavigationTargetKey(target) : null;
  if (!target || grouping === "none" || target.kind === "workspace_session") {
    return { visibleKey, entryKey: visibleKey };
  }
  const entries = model.groups.flatMap((group) => group.entries);
  if (entries.some((entry) => entry.key === visibleKey)) {
    return { visibleKey, entryKey: visibleKey };
  }
  const matchesTask = (entry: SessionNavigationEntry): boolean =>
    entry.target.kind !== "workspace_session" &&
    entry.target.workspaceId === target.workspaceId &&
    entry.target.taskId === target.taskId;
  const entry =
    entries.find((entry) => matchesTask(entry) && entry.attention.length === 0) ??
    entries.find(matchesTask);
  return { visibleKey, entryKey: entry?.key ?? visibleKey };
};
