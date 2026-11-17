import type { SidebarSessionGrouping } from "@openducktor/contracts";
import { createContext, useContext, useSyncExternalStore } from "react";
import {
  type SessionNavigationTarget,
  sessionNavigationTargetKey,
} from "@openducktor/frontend-core/sessions/navigation/session-navigation-target";
import type {
  SessionNavigationEntry,
  SessionNavigationModel,
} from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";

export type SessionSelection = {
  visibleKey: string | null;
  entryKey: string | null;
};

/**
 * The selection of the session list, as a store. Each row reads only whether it is selected or
 * visible, so a session switch renders the rows that changed, not every row of the list.
 */
export type SessionSelectionStore = {
  get(): SessionSelection;
  set(next: SessionSelection): void;
  subscribe(listener: () => void): () => void;
};

export const createSessionSelectionStore = (initial: SessionSelection): SessionSelectionStore => {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(next) {
      if (next.entryKey === current.entryKey && next.visibleKey === current.visibleKey) return;
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export const SessionSelectionContext = createContext<SessionSelectionStore | null>(null);

export const useSessionEntrySelection = (entryKey: string) => {
  const store = useContext(SessionSelectionContext);
  if (!store) throw new Error("SessionSelectionContext is missing.");
  const isSelected = useSyncExternalStore(
    store.subscribe,
    () => store.get().entryKey === entryKey,
    () => store.get().entryKey === entryKey,
  );
  const isVisible = useSyncExternalStore(
    store.subscribe,
    () => store.get().visibleKey === entryKey,
    () => store.get().visibleKey === entryKey,
  );
  return { isSelected, isVisible };
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
