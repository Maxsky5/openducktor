import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  buildSessionsPageHref,
  parseSessionsPageKind,
  SESSIONS_QUERY_KEYS,
} from "@/features/session-navigation/session-navigation-target";
import { errorMessage } from "@/lib/errors";
import { useWorkspaceState } from "@/state/app-state-provider";

export type SessionsWorkspaceMatch =
  | { kind: "ready" }
  | { kind: "pending" }
  | { kind: "failed"; message: string; retry: (() => void) | null };

type SwitchAttempt = { locationKey: string; retry: number };

/**
 * Keep the workspace named in the Sessions address and the active workspace in step.
 *
 * A new address that names another workspace opens that workspace. When the active workspace
 * changes for another reason, for example from the workspace rail, the address follows the
 * active workspace and drops the old selection. This also applies while the address still
 * waits for its own workspace. Content renders only when both agree.
 */
export function useSessionsWorkspaceMatch(): SessionsWorkspaceMatch {
  const { workspaces, closedWorkspaces, activeWorkspace, selectWorkspace } = useWorkspaceState();
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const requestedWorkspaceId = params.get(SESSIONS_QUERY_KEYS.workspace);
  const kind = parseSessionsPageKind(params.get(SESSIONS_QUERY_KEYS.kind));
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const isOpen = workspaces.some((workspace) => workspace.workspaceId === requestedWorkspaceId);
  // The active workspace when the address first named another one, and whether they matched.
  const originRef = useRef<{ locationKey: string; activeWorkspaceId: string } | null>(null);
  const matchedLocationKeyRef = useRef<string | null>(null);
  const attemptRef = useRef<SwitchAttempt | null>(null);
  const [retry, setRetry] = useState(0);
  const [failure, setFailure] = useState<{ locationKey: string; message: string } | null>(null);
  const [settledAttempt, setSettledAttempt] = useState<SwitchAttempt | null>(null);

  useEffect(() => {
    if (activeWorkspaceId === null) return;
    if (requestedWorkspaceId === null) {
      // An address without a workspace refers to the active one.
      const next = new URLSearchParams(location.search);
      next.set(SESSIONS_QUERY_KEYS.workspace, activeWorkspaceId);
      navigate(
        { pathname: location.pathname, search: `?${next.toString()}`, hash: location.hash },
        { replace: true, state: location.state },
      );
      return;
    }
    if (requestedWorkspaceId === activeWorkspaceId) {
      matchedLocationKeyRef.current = location.key;
      return;
    }
    if (originRef.current?.locationKey !== location.key) {
      originRef.current = { locationKey: location.key, activeWorkspaceId };
    }
    if (
      matchedLocationKeyRef.current === location.key ||
      originRef.current.activeWorkspaceId !== activeWorkspaceId
    ) {
      navigate(buildSessionsPageHref(activeWorkspaceId, kind), { replace: true });
      return;
    }
    if (!isOpen) return;
    const previous = attemptRef.current;
    if (previous?.locationKey === location.key && previous.retry === retry) return;
    const attempt = { locationKey: location.key, retry };
    attemptRef.current = attempt;
    selectWorkspace(requestedWorkspaceId).then(
      () => {
        if (attemptRef.current === attempt) setSettledAttempt(attempt);
      },
      (cause: unknown) => {
        if (attemptRef.current === attempt) {
          setFailure({ locationKey: attempt.locationKey, message: errorMessage(cause) });
        }
      },
    );
  }, [
    activeWorkspaceId,
    isOpen,
    kind,
    location.hash,
    location.key,
    location.pathname,
    location.search,
    location.state,
    navigate,
    requestedWorkspaceId,
    retry,
    selectWorkspace,
  ]);

  if (requestedWorkspaceId === null || activeWorkspaceId === null) return { kind: "pending" };
  if (requestedWorkspaceId === activeWorkspaceId) return { kind: "ready" };
  if (!isOpen) {
    const closed = closedWorkspaces.find((entry) => entry.workspaceId === requestedWorkspaceId);
    return {
      kind: "failed",
      message: closed
        ? `${closed.workspaceName} is closed. Reopen it to see its sessions.`
        : "The requested workspace is not open in OpenDucktor.",
      retry: null,
    };
  }
  const retrySwitch = (): void => {
    setFailure(null);
    setSettledAttempt(null);
    setRetry((value) => value + 1);
  };
  if (failure?.locationKey === location.key) {
    return { kind: "failed", message: failure.message, retry: retrySwitch };
  }
  // Another workspace action can replace this switch before it applies.
  if (settledAttempt?.locationKey === location.key && settledAttempt.retry === retry) {
    return {
      kind: "failed",
      message: "Another workspace action interrupted opening this workspace.",
      retry: retrySwitch,
    };
  }
  return { kind: "pending" };
}
