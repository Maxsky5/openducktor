import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  buildSessionsPageHref,
  parseSessionsPageKind,
  SESSIONS_PATH,
  SESSIONS_QUERY_KEYS,
  type SessionsPageKind,
} from "@/features/session-navigation/sessions-route";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useWorkspaceState } from "@/state/app-state-provider";
import { keptSessionViewAddress, type SessionView } from "./session-view-resolution";

export type SessionsWorkspaceMatch =
  | { kind: "ready" }
  | { kind: "pending" }
  | { kind: "failed"; message: string; retry: (() => void) | null };

type SwitchAttempt = { locationKey: string; retry: number };

/**
 * Keep the workspace named in the Sessions address and the active workspace in step.
 *
 * A new address that names another workspace opens that workspace. When the active workspace
 * changes for another reason, for example from the workspace rail, the address goes to the
 * kept address of that workspace and content kind. Without one, the address names the workspace
 * without a selection. This also applies while the address still waits for its own workspace.
 * Content renders only when both agree.
 */
export function useSessionsWorkspaceMatch(
  keptViews: readonly SessionView[],
): SessionsWorkspaceMatch {
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
  // The active workspace when this hook started a switch that did not apply or fail yet.
  const switchOriginRef = useRef<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [failure, setFailure] = useState<{ locationKey: string; message: string } | null>(null);
  const [interruptedAttempt, setInterruptedAttempt] = useState<SwitchAttempt | null>(null);

  const keptAddress = useEffectEvent((workspaceId: string, kind: SessionsPageKind) =>
    keptSessionViewAddress(keptViews, workspaceId, kind),
  );

  useEffect(() => {
    if (activeWorkspaceId === null) return;
    // The switch applied, or another workspace action replaced it.
    if (switchOriginRef.current !== activeWorkspaceId) switchOriginRef.current = null;
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
      if (switchOriginRef.current === null) return;
      // An address of the active workspace, also after Back, replaces a pending switch. The stale
      // attempt is no longer current, so a return to its address starts a new switch.
      switchOriginRef.current = null;
      attemptRef.current = { locationKey: location.key, retry };
      startTransition(() => {
        // Selection reports host failures.
        void selectWorkspace(activeWorkspaceId).catch(() => {});
      });
      return;
    }
    if (originRef.current?.locationKey !== location.key) {
      originRef.current = { locationKey: location.key, activeWorkspaceId };
    }
    if (
      matchedLocationKeyRef.current === location.key ||
      originRef.current.activeWorkspaceId !== activeWorkspaceId
    ) {
      const kept = kind === null ? null : keptAddress(activeWorkspaceId, kind);
      navigate(
        kept
          ? { pathname: SESSIONS_PATH, search: kept.search }
          : buildSessionsPageHref(activeWorkspaceId, kind),
        { replace: true, state: kept?.state },
      );
      return;
    }
    if (!isOpen) return;
    const previous = attemptRef.current;
    if (previous?.locationKey === location.key && previous.retry === retry) return;
    const attempt = { locationKey: location.key, retry };
    attemptRef.current = attempt;
    switchOriginRef.current = activeWorkspaceId;
    let queued = false;
    // The switch state renders after the kept view of the address paints.
    startTransition(() => {
      selectWorkspace(requestedWorkspaceId, () => {
        queued = true;
      }).then(
        () => {
          if (queued || attemptRef.current !== attempt) return;
          // The queued workspace can commit after this promise resolves.
          switchOriginRef.current = null;
          setInterruptedAttempt(attempt);
        },
        (cause: unknown) => {
          if (attemptRef.current !== attempt) return;
          switchOriginRef.current = null;
          setFailure({ locationKey: attempt.locationKey, message: errorMessage(cause) });
        },
      );
    });
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

  if (isSessionsWorkspaceReady(requestedWorkspaceId, activeWorkspaceId)) return { kind: "ready" };
  if (requestedWorkspaceId === null || activeWorkspaceId === null) return { kind: "pending" };
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
    setInterruptedAttempt(null);
    setRetry((value) => value + 1);
  };
  if (failure?.locationKey === location.key) {
    return { kind: "failed", message: failure.message, retry: retrySwitch };
  }
  // Another workspace action can replace this switch before it applies.
  if (interruptedAttempt?.locationKey === location.key && interruptedAttempt.retry === retry) {
    return {
      kind: "failed",
      message: "Another workspace action interrupted opening this workspace.",
      retry: retrySwitch,
    };
  }
  return { kind: "pending" };
}

/** Content renders only when the address names the active workspace. */
export const isSessionsWorkspaceReady = (
  requestedWorkspaceId: string | null,
  activeWorkspaceId: string | null,
): boolean => requestedWorkspaceId !== null && requestedWorkspaceId === activeWorkspaceId;
