import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import {
  type AgentStudioNavigationState,
  type AgentStudioQueryUpdate,
  applyQueryUpdateToNavigationState,
  buildSearchParamsFromNavigationState,
  isSameNavigationState,
  parseNavigationStateFromSearchParams,
} from "./agent-studio-navigation";

type UseNavigationUrlSyncArgs = {
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
};

type UseNavigationUrlSyncResult = {
  navigation: AgentStudioNavigationState;
  setNavigation: Dispatch<SetStateAction<AgentStudioNavigationState>>;
  updateQuery: (updates: AgentStudioQueryUpdate) => void;
};

export function useNavigationUrlSync({
  searchParams,
  setSearchParams,
}: UseNavigationUrlSyncArgs): UseNavigationUrlSyncResult {
  const syncingFromSearchParamsRef = useRef(false);
  const searchParamsUpdatePendingRef = useRef(false);
  const [navigation, setNavigation] = useState<AgentStudioNavigationState>(() =>
    parseNavigationStateFromSearchParams(searchParams),
  );

  const updateQuery = useCallback((updates: AgentStudioQueryUpdate): void => {
    setNavigation((current) => applyQueryUpdateToNavigationState(current, updates));
  }, []);

  useEffect(() => {
    searchParamsUpdatePendingRef.current = false;
    const parsed = parseNavigationStateFromSearchParams(searchParams);
    setNavigation((current) => {
      if (isSameNavigationState(current, parsed)) {
        return current;
      }
      syncingFromSearchParamsRef.current = true;
      return parsed;
    });
  }, [searchParams]);

  useEffect(() => {
    if (syncingFromSearchParamsRef.current) {
      syncingFromSearchParamsRef.current = false;
      return;
    }

    if (searchParamsUpdatePendingRef.current) {
      return;
    }

    const next = buildSearchParamsFromNavigationState(searchParams, navigation);
    if (next.toString() === searchParams.toString()) {
      return;
    }

    searchParamsUpdatePendingRef.current = true;
    setSearchParams(next, { replace: true });
  }, [navigation, searchParams, setSearchParams]);

  return {
    navigation,
    setNavigation,
    updateQuery,
  };
}
