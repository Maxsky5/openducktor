import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useBlocker } from "react-router";
import { SESSIONS_PATH } from "@/features/session-navigation/session-navigation-target";

type RequestTransition = (
  apply: () => void | Promise<void | boolean>,
  cancel?: () => void,
  options?: { waitForSuccess?: boolean; kind?: "root_branch_switch" },
) => void;
type GuardContext = {
  register: (guard: RequestTransition, cancelPending?: () => void) => () => void;
  run: RequestTransition;
  cancelPending: () => void;
};

const context = createContext<GuardContext | null>(null);

export function WorkspacePreviewTransitionGuardProvider({ children }: { children: ReactNode }) {
  const activeGuard = useRef<{
    run: RequestTransition;
    cancelPending: (() => void) | undefined;
  } | null>(null);
  const register = useCallback((guard: RequestTransition, cancelPending?: () => void) => {
    const entry = { run: guard, cancelPending };
    activeGuard.current = entry;
    return () => {
      if (activeGuard.current === entry) activeGuard.current = null;
    };
  }, []);
  const run = useCallback<RequestTransition>((apply, cancel, options) => {
    if (activeGuard.current) activeGuard.current.run(apply, cancel, options);
    else apply();
  }, []);
  const cancelPending = useCallback(() => activeGuard.current?.cancelPending?.(), []);
  const value = useMemo(() => ({ register, run, cancelPending }), [register, run, cancelPending]);
  return <context.Provider value={value}>{children}</context.Provider>;
}

export function useWorkspacePreviewTransitionGuard(): GuardContext {
  const value = useContext(context);
  if (!value) throw new Error("Workspace preview transition guard provider is missing.");
  return value;
}

/**
 * Ask the visible session content before Back or Forward replaces it.
 *
 * On the Sessions page the address names the conversation, workspace, and content kind, so
 * any history step to another address can discard unsaved file edits.
 */
export function WorkspacePreviewRouteGuard() {
  const { run } = useWorkspacePreviewTransitionGuard();
  const blocker = useBlocker(
    ({ currentLocation, nextLocation, historyAction }) =>
      historyAction === "POP" &&
      currentLocation.pathname === SESSIONS_PATH &&
      (nextLocation.pathname !== currentLocation.pathname ||
        nextLocation.search !== currentLocation.search),
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    run(
      () => blocker.proceed(),
      () => blocker.reset(),
    );
  }, [blocker, run]);
  return null;
}
