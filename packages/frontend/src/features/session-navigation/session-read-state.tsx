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
import type { WorkspaceSession } from "@openducktor/contracts";
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
import {
  sessionNavigationTargetKey,
  type SessionNavigationTarget,
} from "./session-navigation-target";

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

export const useSessionUnread = (entry: SessionNavigationEntry): boolean =>
  useSessionUnreadKey(sessionEntryReadKey(entry));

export const useSetSessionUnread = (): ((
  entry: SessionNavigationEntry,
  unread: boolean,
) => void) => {
  const setUnread = useSetSessionUnreadKey();
  return useCallback((entry, unread) => setUnread(sessionEntryReadKey(entry), unread), [setUnread]);
};

/** Whether the session with this read key shows as unread. A null key is never unread. */
export const useSessionUnreadKey = (key: string | null): boolean => {
  const store = useRequiredContext(SessionReadStateContext, "useSessionUnreadKey");
  const isUnread = (): boolean => key !== null && store.isUnread(key);
  return useSyncExternalStore(store.subscribe, isUnread, isUnread);
};

export const useSetSessionUnreadKey = (): ((key: string, unread: boolean) => void) => {
  const store = useRequiredContext(SessionReadStateContext, "useSetSessionUnreadKey");
  return useCallback((key, unread) => store.setUnread(key, unread), [store]);
};

/** The read key of a chat. Its sidebar row uses the same key. */
export const workspaceSessionReadKey = (workspaceId: string, session: WorkspaceSession): string => {
  const identity = workspaceSessionIdentity(session);
  return identity
    ? sessionReadStateKey(workspaceId, identity)
    : sessionNavigationTargetKey({ kind: "workspace_session", workspaceId, sessionId: session.id });
};

/** Watch task metadata even when the sidebar has no row for the task. */
export const useWatchSessionBlockers = (model: SessionNavigationModel): void => {
  const store = useRequiredContext(SessionReadStateContext, "useWatchSessionBlockers");
  useEffect(() => {
    for (const snapshot of model.taskBlocks) {
      store.observeTaskBlocks(
        snapshot.workspaceId,
        snapshot.tasks.map(({ taskId, blocked, target }) => ({
          taskId,
          blocked,
          readKey: target ? targetReadKey(target) : null,
        })),
      );
    }
  }, [model, store]);
};

const sessionEntryReadKey = (entry: SessionNavigationEntry): string =>
  entry.context.kind === "workspace"
    ? workspaceSessionReadKey(entry.workspace.workspaceId, entry.context.session)
    : targetReadKey(entry.target);

const targetReadKey = (target: SessionNavigationTarget): string =>
  target.kind === "task_session"
    ? sessionReadStateKey(target.workspaceId, target.identity)
    : sessionNavigationTargetKey(target);
