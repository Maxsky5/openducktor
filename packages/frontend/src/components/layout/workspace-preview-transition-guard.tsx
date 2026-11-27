import type { ArchiveFileDraft } from "@openducktor/frontend-core/operations/background-operation-store";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { type Location, useBlocker } from "react-router";
import { SESSIONS_PATH } from "@/features/session-navigation/sessions-route";

type RequestTransition = (
  apply: (archiveDraft?: ArchiveFileDraft) => void | Promise<void | boolean>,
  cancel?: () => void,
  options?: { waitForSuccess?: boolean; kind?: "root_branch_switch" | "archive_chat" },
) => void;
/**
 * A page that must ask before any route change leaves it, such as an editor with an unsaved
 * change. A router has one blocker, so the app route guard asks this guard too.
 */
export type RouteLeaveGuard = {
  /** Whether a move from the current location to the next one must wait for the user. */
  readonly blocks: (current: Location, next: Location) => boolean;
  /** Asks the user. The guard calls `proceed` to leave or `reset` to stay. */
  readonly ask: (proceed: () => void, reset: () => void) => void;
};
type GuardContext = {
  register: (guard: RequestTransition, cancelPending?: () => void) => () => void;
  run: RequestTransition;
  cancelPending: () => void;
  registerLeaveGuard: (guard: RouteLeaveGuard) => () => void;
  readonly leaveGuard: { readonly current: RouteLeaveGuard | null };
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
  const leaveGuard = useRef<RouteLeaveGuard | null>(null);
  const registerLeaveGuard = useCallback((guard: RouteLeaveGuard) => {
    leaveGuard.current = guard;
    return () => {
      if (leaveGuard.current === guard) leaveGuard.current = null;
    };
  }, []);
  const value = useMemo(
    () => ({ register, run, cancelPending, registerLeaveGuard, leaveGuard }),
    [register, run, cancelPending, registerLeaveGuard],
  );
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
  const { run, leaveGuard } = useWorkspacePreviewTransitionGuard();
  // The registered leave guard that blocked the pending move, if any.
  const blockedBy = useRef<RouteLeaveGuard | null>(null);
  const blocker = useBlocker(({ currentLocation, nextLocation, historyAction }) => {
    const leave = leaveGuard.current;
    blockedBy.current = leave?.blocks(currentLocation, nextLocation) ? leave : null;
    return (
      blockedBy.current !== null ||
      (historyAction === "POP" &&
        currentLocation.pathname === SESSIONS_PATH &&
        (nextLocation.pathname !== currentLocation.pathname ||
          nextLocation.search !== currentLocation.search))
    );
  });
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const proceed = () => blocker.proceed();
    const reset = () => blocker.reset();
    if (blockedBy.current) blockedBy.current.ask(proceed, reset);
    else run(proceed, reset);
  }, [blocker, run]);
  return null;
}

/** Registers a leave guard while the calling page shows. Pass a stable guard. */
export function useRouteLeaveGuard(guard: RouteLeaveGuard): void {
  const { registerLeaveGuard } = useWorkspacePreviewTransitionGuard();
  useEffect(() => registerLeaveGuard(guard), [guard, registerLeaveGuard]);
}
