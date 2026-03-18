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
  const latestSearchParamsRef = useRef<URLSearchParams>(new URLSearchParams(searchParams));
  const pendingSearchParamWritesRef = useRef<string[]>([]);
  const [navigation, setNavigation] = useState<AgentStudioNavigationState>(() =>
    parseNavigationStateFromSearchParams(searchParams),
  );

  const updateQuery = useCallback((updates: AgentStudioQueryUpdate): void => {
    setNavigation((current) => applyQueryUpdateToNavigationState(current, updates));
  }, []);

  useEffect(() => {
    const currentSearchParams = searchParams.toString();
    const pendingWriteIndex = pendingSearchParamWritesRef.current.indexOf(currentSearchParams);
    if (pendingWriteIndex !== -1) {
      pendingSearchParamWritesRef.current = pendingSearchParamWritesRef.current.slice(
        pendingWriteIndex + 1,
      );

      if (pendingSearchParamWritesRef.current.length === 0) {
        latestSearchParamsRef.current = new URLSearchParams(searchParams);
      }
      return;
    }

    pendingSearchParamWritesRef.current = [];
    latestSearchParamsRef.current = new URLSearchParams(searchParams);

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

    const currentSearchParams = latestSearchParamsRef.current.toString();
    const next = buildSearchParamsFromNavigationState(latestSearchParamsRef.current, navigation);
    const nextSearchParams = next.toString();
    if (nextSearchParams === currentSearchParams) {
      return;
    }

    latestSearchParamsRef.current = new URLSearchParams(next);
    if (pendingSearchParamWritesRef.current.at(-1) !== nextSearchParams) {
      pendingSearchParamWritesRef.current = [
        ...pendingSearchParamWritesRef.current,
        nextSearchParams,
      ];
    }
    setSearchParams(next, { replace: true });
  }, [navigation, setSearchParams]);

  return {
    navigation,
    setNavigation,
    updateQuery,
  };
}
