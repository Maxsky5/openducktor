import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
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
  /** The committed target, for an event handler that must not render on each change. */
  readVisible: () => VisibleSession | null;
};

// Publishers only write, so they read stable controls and do not render again on each change.
const VisibleSessionContext = createContext<VisibleSession | null | undefined>(undefined);
const VisibleSessionControlsContext = createContext<VisibleSessionControls | null>(null);

export function VisibleSessionTargetProvider({ children }: PropsWithChildren): ReactElement {
  const [visible, setVisible] = useState<VisibleSession | null>(null);
  const visibleRef = useRef(visible);
  useLayoutEffect(() => {
    visibleRef.current = visible;
  }, [visible]);
  const [controls] = useState((): VisibleSessionControls => ({
    publish(next) {
      setVisible((current) => (current && sameVisibleSession(current, next) ? current : next));
    },
    clear(viewId, targetKey) {
      setVisible((current) =>
        current &&
        current.viewId === viewId &&
        sessionNavigationTargetKey(current.target) === targetKey
          ? null
          : current,
      );
    },
    hideView(viewId) {
      setVisible((current) => (current?.viewId === viewId ? null : current));
    },
    readVisible: () => visibleRef.current,
  }));
  return (
    <VisibleSessionControlsContext.Provider value={controls}>
      <VisibleSessionContext.Provider value={visible}>{children}</VisibleSessionContext.Provider>
    </VisibleSessionControlsContext.Provider>
  );
}

const sameVisibleSession = (left: VisibleSession, right: VisibleSession): boolean =>
  left.viewId === right.viewId &&
  left.readKey === right.readKey &&
  sessionNavigationTargetKey(left.target) === sessionNavigationTargetKey(right.target);

export const useVisibleSessionControls = (): VisibleSessionControls => {
  const controls = useContext(VisibleSessionControlsContext);
  if (!controls) throw new Error("VisibleSessionTargetProvider is missing.");
  return controls;
};

export const useVisibleSessionView = (): VisibleSession | null => {
  const visible = useContext(VisibleSessionContext);
  if (visible === undefined) throw new Error("VisibleSessionTargetProvider is missing.");
  return visible;
};

export const useVisibleSessionTarget = (): SessionNavigationTarget | null =>
  useVisibleSessionView()?.target ?? null;

export const useVisibleSessionReadKey = (): string | null =>
  useVisibleSessionView()?.readKey ?? null;

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
