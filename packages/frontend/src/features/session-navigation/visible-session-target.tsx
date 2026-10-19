import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
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
type VisibleSession = {
  target: SessionNavigationTarget;
  readKey: string | null;
  viewId: string | null;
};
type VisibleSessionTargetStore = {
  visible: VisibleSession | null;
  setVisible: (update: (current: VisibleSession | null) => VisibleSession | null) => void;
};

const VisibleSessionTargetContext = createContext<VisibleSessionTargetStore | null>(null);

export function VisibleSessionTargetProvider({ children }: PropsWithChildren): ReactElement {
  const [visible, setVisible] = useState<VisibleSession | null>(null);
  const value = useMemo(() => ({ visible, setVisible }), [visible]);
  return (
    <VisibleSessionTargetContext.Provider value={value}>
      {children}
    </VisibleSessionTargetContext.Provider>
  );
}

const useVisibleSessionTargetStore = (): VisibleSessionTargetStore => {
  const store = useContext(VisibleSessionTargetContext);
  if (!store) throw new Error("VisibleSessionTargetProvider is missing.");
  return store;
};

export const useVisibleSessionView = (): VisibleSession | null =>
  useVisibleSessionTargetStore().visible;

export const useVisibleSessionTarget = (): SessionNavigationTarget | null =>
  useVisibleSessionView()?.target ?? null;

export const useVisibleSessionReadKey = (): string | null =>
  useVisibleSessionTargetStore().visible?.readKey ?? null;

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
  const { setVisible } = useVisibleSessionTargetStore();
  const viewId = useContext(SessionViewContext)?.id ?? null;
  const readKey = visibleReadKey(target, workspaceSessionIdentity);
  useEffect(() => {
    if (!target) return;
    const key = sessionNavigationTargetKey(target);
    setVisible(() => ({ target, readKey, viewId }));
    return () => {
      setVisible((current) =>
        current && current.viewId === viewId && sessionNavigationTargetKey(current.target) === key
          ? null
          : current,
      );
    };
  }, [readKey, setVisible, target, viewId]);
};
