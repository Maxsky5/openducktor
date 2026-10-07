import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import type { SetURLSearchParams } from "react-router";

type Navigation = {
  sessionId: string | null | undefined;
  creating: boolean;
};

type UseWorkspaceSessionNavigationArgs = {
  workspaceId: string;
  locationKey: string;
  navigationType: "POP" | "PUSH" | "REPLACE";
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
};

type WorkspaceSessionNavigation = Navigation & {
  updateNavigation: (update: Partial<Navigation>, replace?: boolean) => void;
};

export function useWorkspaceSessionNavigation({
  workspaceId,
  locationKey,
  navigationType,
  searchParams,
  setSearchParams,
}: UseWorkspaceSessionNavigationArgs): WorkspaceSessionNavigation {
  const [scope, setScope] = useState({ workspaceId, searchParams });
  const [navigation, setNavigation] = useState<Navigation>(() => ({
    sessionId: searchParams.get("session") ?? undefined,
    creating: searchParams.get("create") === "session",
  }));
  const latestSearchParams = useRef(searchParams);
  const pendingWrites = useRef<string[]>([]);
  const syncingFromUrl = useRef(false);
  const replaceHistory = useRef(true);
  let currentNavigation = navigation;
  if (scope.workspaceId !== workspaceId) {
    setScope({ workspaceId, searchParams });
    currentNavigation = {
      sessionId: searchParams.get("session") ?? undefined,
      creating: searchParams.get("create") === "session",
    };
    setNavigation(currentNavigation);
  }

  useEffect(() => {
    latestSearchParams.current = scope.searchParams;
    pendingWrites.current = [];
    syncingFromUrl.current = false;
    replaceHistory.current = true;
  }, [scope]);

  const updateNavigation = useCallback((update: Partial<Navigation>, replace = true): void => {
    replaceHistory.current = replace;
    setNavigation((current) => {
      const next = { ...current, ...update };
      return next.sessionId === current.sessionId && next.creating === current.creating
        ? current
        : next;
    });
  }, []);

  useEffect(() => {
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
    const sessionId = searchParams.get("session") ?? undefined;
    const creating = searchParams.get("create") === "session";
    setNavigation((current) => {
      if (current.sessionId === sessionId && current.creating === creating) return current;
      return { sessionId, creating };
    });
  }, [locationKey, navigationType, scope, searchParams]);

  useEffect(() => {
    if (syncingFromUrl.current) {
      syncingFromUrl.current = false;
      return;
    }
    const next = new URLSearchParams(latestSearchParams.current);
    if (navigation.sessionId) next.set("session", navigation.sessionId);
    else next.delete("session");
    if (navigation.creating) next.set("create", "session");
    else next.delete("create");
    const nextKey = next.toString();
    if (nextKey === latestSearchParams.current.toString()) return;
    latestSearchParams.current = next;
    pendingWrites.current.push(nextKey);
    // Commit local selection before asking the router to persist it.
    startTransition(() => {
      setSearchParams(next, { replace: replaceHistory.current, preventScrollReset: true });
    });
  }, [locationKey, navigation, navigationType, scope, searchParams, setSearchParams]);

  return { ...currentNavigation, updateNavigation };
}
