import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useRequiredContext } from "@/state/app-state-contexts";
import type {
  SessionNavigationEntry,
  SessionNavigationModel,
} from "@/state/read-models/session-navigation-read-model";
import { workspaceSessionIdentity } from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import { WorkspaceActivityContext } from "@/state/workspace-activity/workspace-activity-context";
import {
  createSessionReadStateStore,
  sessionReadStateKey,
  type SessionReadStateStore,
} from "./session-read-state-store";
import { useVisibleSessionReadKey } from "./visible-session-target";

const SessionReadStateContext = createContext<SessionReadStateStore | null>(null);

/** One memory store for the app shell, independent of sidebar scope, layout, and navigation. */
export function SessionReadStateProvider({ children }: PropsWithChildren): ReactElement {
  const observer = useRequiredContext(WorkspaceActivityContext, "SessionReadStateProvider");
  const [store] = useState(createSessionReadStateStore);
  const visibleKey = useVisibleSessionReadKey();

  useLayoutEffect(() => {
    const updateVisibility = () =>
      store.setVisibleKey(document.visibilityState === "hidden" ? null : visibleKey);
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, [store, visibleKey]);
  useEffect(() => {
    const update = () => store.observeLiveSnapshot(observer.getSessionLiveSnapshot());
    // Subscribe synchronously to each activity change, including changes React batches together.
    const unsubscribe = observer.subscribe(update);
    update();
    return unsubscribe;
  }, [observer, store]);

  return <SessionReadStateContext value={store}>{children}</SessionReadStateContext>;
}

export const useSessionUnread = (entry: SessionNavigationEntry): boolean => {
  const store = useRequiredContext(SessionReadStateContext, "useSessionUnread");
  const key = sessionEntryReadKey(entry);
  return useSyncExternalStore(
    store.subscribe,
    () => store.isUnread(key),
    () => store.isUnread(key),
  );
};

export const useSetSessionUnread = (): ((
  entry: SessionNavigationEntry,
  unread: boolean,
) => void) => {
  const store = useRequiredContext(SessionReadStateContext, "useSetSessionUnread");
  return useCallback(
    (entry, unread) => store.setUnread(sessionEntryReadKey(entry), unread),
    [store],
  );
};

/** Mark a task's latest entry unread when a new blocker appears. */
export const useWatchSessionBlockers = (model: SessionNavigationModel): void => {
  const store = useRequiredContext(SessionReadStateContext, "useWatchSessionBlockers");
  useEffect(() => {
    for (const group of model.groups) {
      for (const entry of group.entries) {
        store.observeBlocked(sessionEntryReadKey(entry), entry.attention.includes("blocked"));
      }
    }
  }, [model, store]);
};

const sessionEntryReadKey = (entry: SessionNavigationEntry): string => {
  if (entry.target.kind === "task_session") {
    return sessionReadStateKey(entry.workspace.workspaceId, entry.target.identity);
  }
  if (entry.context.kind === "workspace") {
    const identity = workspaceSessionIdentity(entry.context.session);
    if (identity) return sessionReadStateKey(entry.workspace.workspaceId, identity);
  }
  return entry.key;
};
