import type { WorkspaceSession } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type SetURLSearchParams, useNavigate } from "react-router";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  useDraftViewLease,
  useNewWorkspaceSessionDraft,
} from "@openducktor/frontend-core/drafts/use-new-workspace-session-drafts";
import type { useMountedRef } from "@openducktor/frontend-core/lib/use-mounted-ref";
import { repoBranchesQueryOptions } from "@openducktor/frontend-core/queries/git";
import { repoConfigQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { useSessionViewShown } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import { findSavedWorkspaceStartupAttemptForDraft } from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import {
  useWorkspaceSessionStartupPending,
  useWorkspaceSessionStartupTitle,
} from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { buildWorkspaceSessionDraftHref } from "@/features/session-navigation/sessions-route";
import { useWorkspaceState } from "@/state/app-state-provider";
import { useWorkspaceSessionNavigation } from "./use-workspace-session-navigation";
import type { HeaderChromeReveal } from "./workspace-session-header";

type HandedOffSession = {
  id: string;
  workspaceId: string;
  record: WorkspaceSession;
  revealed: boolean;
};

export function useWorkspaceSessionDraftLifecycle({
  workspaceId,
  locationKey,
  navigationType,
  searchParams,
  setSearchParams,
  isActive,
  sessions,
  mounted,
}: {
  workspaceId: string;
  locationKey: string;
  navigationType: "POP" | "PUSH" | "REPLACE";
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
  isActive: boolean;
  sessions: WorkspaceSession[];
  mounted: ReturnType<typeof useMountedRef>;
}) {
  const queryClient = useQueryClient();
  const connection = useClientConnection();
  const draftStore = connection.drafts.newWorkspaceSessions;
  const { workspaces, selectWorkspace } = useWorkspaceState();
  const navigate = useNavigate();
  const isShown = useSessionViewShown();
  const isLive = isActive && isShown;
  const { sessionId, draftId, updateNavigation } = useWorkspaceSessionNavigation({
    workspaceId,
    locationKey,
    navigationType,
    searchParams,
    setSearchParams,
    enabled: isLive,
  });
  const activeDraft = useNewWorkspaceSessionDraft(draftId);
  const matchingDraft = activeDraft && activeDraft.workspaceId === workspaceId ? activeDraft : null;
  const switchingDraftIdRef = useRef<string | null>(null);
  const workspaceIdRef = useRef(workspaceId);
  const isActiveRef = useRef(isLive);
  const currentDraftIdRef = useRef<string | null>(isLive ? draftId : null);
  useLayoutEffect(() => {
    workspaceIdRef.current = workspaceId;
    isActiveRef.current = isLive;
    currentDraftIdRef.current = isLive ? draftId : null;
    if (!isLive || matchingDraft !== null) {
      switchingDraftIdRef.current = null;
    }
  }, [draftId, isLive, matchingDraft, workspaceId]);

  // Recover a stale/missing draft URL (e.g. after reload on an untouched draft) with a fresh draft.
  useEffect(() => {
    if (
      !isLive ||
      draftId === null ||
      matchingDraft !== null ||
      switchingDraftIdRef.current === draftId
    ) {
      return;
    }
    const savedAttempt = findSavedWorkspaceStartupAttemptForDraft(
      connection.startupAttempts.getSnapshot(),
      draftId,
    );
    if (savedAttempt) {
      updateNavigation({ draftId: null, sessionId: savedAttempt.ownership.target.record.id }, true);
      return;
    }
    const replacement = draftStore.createDraft(workspaceId);
    updateNavigation({ draftId: replacement.id, sessionId: null }, true);
  }, [
    connection.startupAttempts,
    draftId,
    draftStore,
    isLive,
    matchingDraft,
    updateNavigation,
    workspaceId,
  ]);

  useDraftViewLease(draftId, isLive);

  const handleDiscardDraft = useCallback(() => {
    if (!matchingDraft) return;
    const idToDelete = matchingDraft.id;
    if (!draftStore.discard(idToDelete)) return;
    const nextSession = sessions[0] ?? null;
    updateNavigation({ draftId: null, sessionId: nextSession?.id ?? null }, true);
  }, [draftStore, matchingDraft, sessions, updateNavigation]);

  const handleSwitchDraftWorkspace = useCallback(
    (nextWorkspaceId: string) => {
      if (!matchingDraft || nextWorkspaceId === workspaceId) return;
      const movingDraftId = matchingDraft.id;
      const nextWorkspace = workspaces.find((entry) => entry.workspaceId === nextWorkspaceId);
      void queryClient.prefetchQuery(repoConfigQueryOptions(nextWorkspaceId));
      if (nextWorkspace) {
        void queryClient.prefetchQuery(repoBranchesQueryOptions(nextWorkspace.repoPath));
      }
      void selectWorkspace(
        nextWorkspaceId,
        () => {
          if (
            !mounted.current ||
            !isActiveRef.current ||
            workspaceIdRef.current !== workspaceId ||
            currentDraftIdRef.current !== movingDraftId ||
            !draftStore.getDraft(movingDraftId)
          ) {
            return;
          }
          switchingDraftIdRef.current = movingDraftId;
          const { removedReferenceCount } = draftStore.switchWorkspace(
            movingDraftId,
            nextWorkspaceId,
          );
          if (removedReferenceCount > 0) {
            const suffix = removedReferenceCount === 1 ? "" : "s";
            connection.feedback.show(
              "info",
              `Removed ${removedReferenceCount} workspace-specific reference${suffix} after switching workspace.`,
            );
          }
          void navigate(buildWorkspaceSessionDraftHref(nextWorkspaceId, movingDraftId), {
            replace: true,
          });
        },
        { immediate: true },
      ).catch(() => {});
    },
    [
      connection.feedback,
      draftStore,
      matchingDraft,
      mounted,
      navigate,
      queryClient,
      selectWorkspace,
      workspaceId,
      workspaces,
    ],
  );

  const [handedOffSession, setHandedOffSession] = useState<HandedOffSession | null>(null);

  const handleSavedDraftRecord = useCallback(
    (record: WorkspaceSession, _startupAttemptId: string, savedDraftId: string): boolean => {
      if (
        mounted.current &&
        isActiveRef.current &&
        workspaceIdRef.current === workspaceId &&
        currentDraftIdRef.current === savedDraftId
      ) {
        switchingDraftIdRef.current = savedDraftId;
        setHandedOffSession({ id: record.id, workspaceId, record, revealed: false });
        updateNavigation({ draftId: null, sessionId: record.id }, true);
        return true;
      }
      return false;
    },
    [mounted, updateNavigation, workspaceId],
  );

  return {
    isLive,
    sessionId,
    draftId,
    updateNavigation,
    matchingDraft,
    handedOffSession,
    setHandedOffSession,
    handleDiscardDraft,
    handleSwitchDraftWorkspace,
    handleSavedDraftRecord,
  };
}

export function useHandedOffSessionState(
  workspaceId: string,
  selectedId: string | null,
  isDraftMode: boolean,
  handedOffSession: HandedOffSession | null,
  setHandedOffSession: Dispatch<SetStateAction<HandedOffSession | null>>,
) {
  const isStartupPending = useWorkspaceSessionStartupPending(workspaceId, selectedId);
  const startupTitleFallback = useWorkspaceSessionStartupTitle(workspaceId, selectedId);
  const isSameHandedOff =
    !isDraftMode &&
    selectedId !== null &&
    handedOffSession?.id === selectedId &&
    handedOffSession.workspaceId === workspaceId;
  const effectiveHandedOff = isSameHandedOff ? handedOffSession : null;
  const handedOffId = effectiveHandedOff?.id ?? null;
  const handedOffRevealed = effectiveHandedOff?.revealed ?? true;

  useEffect(() => {
    if (handedOffId === null || handedOffRevealed || isStartupPending) return;
    const frame = requestAnimationFrame(() => {
      setHandedOffSession((current) =>
        current && current.id === handedOffId ? { ...current, revealed: true } : current,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [handedOffId, handedOffRevealed, isStartupPending, setHandedOffSession]);

  const deferRightReveal = effectiveHandedOff !== null && (!handedOffRevealed || isStartupPending);
  let headerChromeReveal: HeaderChromeReveal = "default";
  if (deferRightReveal) headerChromeReveal = "deferred";
  else if (effectiveHandedOff !== null) headerChromeReveal = "smooth";

  return {
    deferRightReveal,
    headerChromeReveal,
    startupTitleFallback,
  };
}
