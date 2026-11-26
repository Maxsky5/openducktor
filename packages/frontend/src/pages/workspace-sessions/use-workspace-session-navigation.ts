import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SetURLSearchParams } from "react-router";

type Navigation = {
  sessionId: string | null | undefined;
  draftId: string | null;
};

type UseWorkspaceSessionNavigationArgs = {
  workspaceId: string;
  locationKey: string;
  navigationType: "POP" | "PUSH" | "REPLACE";
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
  enabled: boolean;
};

type WorkspaceSessionNavigation = Navigation & {
  updateNavigation: (update: Partial<Navigation>, replace?: boolean) => void;
};

const readNavigationFromParams = (searchParams: URLSearchParams): Navigation => {
  const draftId = searchParams.get("draft");
  return {
    sessionId: draftId ? null : (searchParams.get("session") ?? undefined),
    draftId,
  };
};

export function useWorkspaceSessionNavigation({
  workspaceId,
  locationKey,
  navigationType,
  searchParams,
  setSearchParams,
  enabled,
}: UseWorkspaceSessionNavigationArgs): WorkspaceSessionNavigation {
  const [scope, setScope] = useState({ workspaceId, searchParams });
  const [navigation, setNavigation] = useState<Navigation>(() =>
    readNavigationFromParams(searchParams),
  );
  const latestSearchParams = useRef(searchParams);
  const pendingWrites = useRef<string[]>([]);
  const syncingFromUrl = useRef(false);
  const replaceHistory = useRef(true);
  let currentNavigation = navigation;
  if (scope.workspaceId !== workspaceId) {
    setScope({ workspaceId, searchParams });
    currentNavigation = readNavigationFromParams(searchParams);
    setNavigation(currentNavigation);
  }

  useEffect(() => {
    latestSearchParams.current = scope.searchParams;
    pendingWrites.current = [];
    syncingFromUrl.current = false;
    replaceHistory.current = true;
  }, [scope]);

  const enabledRef = useRef(enabled);
  useLayoutEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  const updateNavigation = useCallback((update: Partial<Navigation>, replace = true): void => {
    if (!enabledRef.current) return;
    syncingFromUrl.current = false;
    replaceHistory.current = replace;
    setNavigation((current) => {
      const next = { ...current, ...update };
      return next.sessionId === current.sessionId && next.draftId === current.draftId
        ? current
        : next;
    });
  }, []);

  useEffect(() => {
    if (!enabled) {
      pendingWrites.current = [];
      latestSearchParams.current = searchParams;
      setNavigation(readNavigationFromParams(searchParams));
      return;
    }
    const writeIndex =
      navigationType === "POP" ? -1 : pendingWrites.current.indexOf(searchParams.toString());
    if (writeIndex !== -1) {
      // A committed location also supersedes any intermediate router renders that were skipped.
      pendingWrites.current.splice(0, writeIndex + 1);
      if (pendingWrites.current.length === 0) latestSearchParams.current = searchParams;
      return;
    }
    pendingWrites.current = [];
    latestSearchParams.current = searchParams;
    syncingFromUrl.current = true;
    replaceHistory.current = true;
    const parsed = readNavigationFromParams(searchParams);
    setNavigation((current) => {
      if (current.sessionId === parsed.sessionId && current.draftId === parsed.draftId) {
        return current;
      }
      return parsed;
    });
  }, [enabled, locationKey, navigationType, scope, searchParams]);

  useEffect(() => {
    if (!enabled) return;
    if (syncingFromUrl.current) {
      syncingFromUrl.current = false;
      return;
    }
    const next = new URLSearchParams(latestSearchParams.current);
    if (navigation.draftId) {
      next.set("draft", navigation.draftId);
      next.delete("session");
    } else {
      next.delete("draft");
      if (navigation.sessionId) next.set("session", navigation.sessionId);
      else next.delete("session");
    }
    const nextKey = next.toString();
    if (nextKey === latestSearchParams.current.toString()) return;
    latestSearchParams.current = next;
    pendingWrites.current.push(nextKey);
    startTransition(() => {
      setSearchParams(next, { replace: replaceHistory.current, preventScrollReset: true });
    });
  }, [enabled, locationKey, navigation, navigationType, scope, searchParams, setSearchParams]);

  // A kept view owns its address. A local request must not replace its chat before the host switches views.
  const activeDraftId = enabled ? currentNavigation.draftId : searchParams.get("draft");
  const ownedSessionId = activeDraftId ? null : searchParams.get("session");
  return {
    draftId: activeDraftId,
    sessionId: activeDraftId ? null : (ownedSessionId ?? currentNavigation.sessionId),
    updateNavigation,
  };
}
