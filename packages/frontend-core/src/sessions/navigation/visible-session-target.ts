import {
  createContext,
  createElement,
  type PropsWithChildren,
  type ReactElement,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";
import { SessionViewContext } from "./session-view-context";
import { sessionReadStateKey } from "./session-read-state-store";
import {
  type SessionNavigationTarget,
  sessionNavigationTargetKey,
} from "./session-navigation-target";

/**
 * Holds the conversation or task context that is on screen now.
 *
 * Content publishes it after its own selection commits, so a pending, cancelled, or failed
 * navigation never marks another entry as selected.
 */
export type VisibleSession = {
  target: SessionNavigationTarget;
  readKey: string | null;
  viewId: string | null;
};
type VisibleSessionControls = {
  publish: (visible: VisibleSession) => void;
  clear: (viewId: string | null, targetKey: string) => void;
  /** Clears the target of a view that left the screen, also when its content never published. */
  hideView: (viewId: string) => void;
  /** The published target, for an event handler that must not render on each change. */
  readVisible: () => VisibleSession | null;
};
type VisibleSessionStore = VisibleSessionControls & {
  subscribe: (listener: () => void) => () => void;
};

/**
 * The provider value never changes, so a published target renders only the components that read
 * it. React does not walk the app tree to look for consumers each time a session opens.
 */
const createVisibleSessionStore = (): VisibleSessionStore => {
  let visible: VisibleSession | null = null;
  const listeners = new Set<() => void>();
  const setVisible = (next: VisibleSession | null): void => {
    if (next === visible) return;
    visible = next;
    for (const listener of listeners) listener();
  };
  return {
    publish(next) {
      if (!visible || !sameVisibleSession(visible, next)) setVisible(next);
    },
    clear(viewId, targetKey) {
      if (visible?.viewId === viewId && sessionNavigationTargetKey(visible.target) === targetKey)
        setVisible(null);
    },
    hideView(viewId) {
      if (visible?.viewId === viewId) setVisible(null);
    },
    readVisible: () => visible,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

const VisibleSessionContext = createContext<VisibleSessionStore | null>(null);

export function VisibleSessionTargetProvider({ children }: PropsWithChildren): ReactElement {
  const [store] = useState(createVisibleSessionStore);
  return createElement(VisibleSessionContext.Provider, { value: store }, children);
}

const sameVisibleSession = (left: VisibleSession, right: VisibleSession): boolean =>
  left.viewId === right.viewId &&
  left.readKey === right.readKey &&
  sessionNavigationTargetKey(left.target) === sessionNavigationTargetKey(right.target);

const useVisibleSessionStore = (): VisibleSessionStore => {
  const store = useContext(VisibleSessionContext);
  if (!store) throw new Error("VisibleSessionTargetProvider is missing.");
  return store;
};

export const useVisibleSessionControls = (): VisibleSessionControls => useVisibleSessionStore();

const useVisibleSessionSelection = <Selected>(
  select: (visible: VisibleSession | null) => Selected,
): Selected => {
  const store = useVisibleSessionStore();
  const read = (): Selected => select(store.readVisible());
  return useSyncExternalStore(store.subscribe, read, read);
};

const selectView = (visible: VisibleSession | null): VisibleSession | null => visible;
const selectTarget = (visible: VisibleSession | null): SessionNavigationTarget | null =>
  visible?.target ?? null;
const selectReadKey = (visible: VisibleSession | null): string | null => visible?.readKey ?? null;

export const useVisibleSessionView = (): VisibleSession | null =>
  useVisibleSessionSelection(selectView);

export const useVisibleSessionTarget = (): SessionNavigationTarget | null =>
  useVisibleSessionSelection(selectTarget);

export const useVisibleSessionReadKey = (): string | null =>
  useVisibleSessionSelection(selectReadKey);

const visibleReadKey = (
  target: SessionNavigationTarget | null,
  workspaceIdentity: AgentSessionIdentity | null,
): string | null => {
  if (!target) return null;
  if (target.kind === "task_session")
    return sessionReadStateKey(target.workspaceId, target.identity);
  if (target.kind === "task") return sessionNavigationTargetKey(target);
  return workspaceIdentity
    ? sessionReadStateKey(target.workspaceId, workspaceIdentity)
    : sessionNavigationTargetKey(target);
};

/**
 * Publish the content's committed target while it stays mounted.
 *
 * Pass a memoized target so the effect runs only when the target changes.
 */
export const usePublishVisibleSessionTarget = (
  target: SessionNavigationTarget | null,
  workspaceSessionIdentity: AgentSessionIdentity | null = null,
): void => {
  const { publish, clear } = useVisibleSessionControls();
  const viewId = useContext(SessionViewContext)?.id ?? null;
  const readKey = visibleReadKey(target, workspaceSessionIdentity);
  useEffect(() => {
    if (!target) return;
    publish({ target, readKey, viewId });
    return () => clear(viewId, sessionNavigationTargetKey(target));
  }, [clear, publish, readKey, target, viewId]);
};
