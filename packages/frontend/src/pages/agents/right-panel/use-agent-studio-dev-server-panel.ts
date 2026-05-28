import type { DevServerEvent, DevServerGroupState } from "@openducktor/contracts";
import { devServerEventSchema } from "@openducktor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  type AgentStudioDevServerPanelMode,
  type AgentStudioDevServerPanelModel,
  DEV_SERVER_DISABLED_REASON,
  DEV_SERVER_EMPTY_REASON,
} from "@/components/features/agents/agent-studio-dev-server-panel";
import { errorMessage } from "@/lib/errors";
import { hostClient, subscribeDevServerEvents } from "@/lib/host-client";
import { devServerGroupStateQueryOptions, devServerQueryKeys } from "@/state/queries/dev-servers";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  applyDevServerEventToState,
  buildOptimisticStartingState,
  buildTaskMemoryKey,
  isDevServerPanelExpanded,
  isDevServerSubscriptionControlEvent,
} from "./use-agent-studio-dev-server-panel-helpers";
import { useAgentStudioDevServerPanelSelection } from "./use-agent-studio-dev-server-panel-selection";
import { useAgentStudioDevServerTerminalBuffers } from "./use-agent-studio-dev-server-terminal-buffers";

export {
  applyDevServerEventToState,
  isDevServerPanelExpanded,
  selectDefaultDevServerTab,
} from "./use-agent-studio-dev-server-panel-helpers";

type UseAgentStudioDevServerPanelArgs = {
  repoPath: string | null;
  taskId: string | null;
  repoSettings: RepoSettingsInput | null;
  enabled: boolean;
};

type DevServerPanelLocalState = {
  liveState: DevServerGroupState | null;
  actionError: string | null;
  subscriptionError: string | null;
};

type DevServerPanelAction =
  | { type: "scopeReset" }
  | { type: "liveStateChanged"; state: DevServerGroupState | null }
  | {
      type: "liveStateUpdated";
      update: (current: DevServerGroupState | null) => DevServerGroupState | null;
    }
  | { type: "actionStarted" }
  | { type: "actionFailed"; error: string }
  | { type: "subscriptionFailed"; error: string }
  | { type: "eventsSynced" }
  | { type: "subscriptionReady" };

const devServerPanelReducer = (
  state: DevServerPanelLocalState,
  action: DevServerPanelAction,
): DevServerPanelLocalState => {
  switch (action.type) {
    case "scopeReset":
      return { liveState: null, actionError: null, subscriptionError: null };
    case "liveStateChanged":
      return { ...state, liveState: action.state };
    case "liveStateUpdated":
      return { ...state, liveState: action.update(state.liveState) };
    case "actionStarted":
      return { ...state, actionError: null };
    case "actionFailed":
      return { ...state, actionError: action.error };
    case "subscriptionFailed":
      return { ...state, subscriptionError: action.error };
    case "eventsSynced":
      return { ...state, actionError: null, subscriptionError: null };
    case "subscriptionReady":
      return { ...state, subscriptionError: null };
  }
};

export function useAgentStudioDevServerPanel({
  repoPath,
  taskId,
  repoSettings,
  enabled,
}: UseAgentStudioDevServerPanelArgs): AgentStudioDevServerPanelModel {
  const queryClient = useQueryClient();
  const forceHydrateFromQueryRef = useRef(false);
  const previousTaskMemoryKeyRef = useRef<string | null | undefined>(undefined);
  const [localState, dispatchLocalState] = useReducer(devServerPanelReducer, {
    liveState: null,
    actionError: null,
    subscriptionError: null,
  });
  const { liveState, actionError, subscriptionError } = localState;

  const configuredScripts = repoSettings?.devServers ?? [];
  const hasConfiguredScripts = configuredScripts.length > 0;
  const queryEnabled = enabled && hasConfiguredScripts && repoPath !== null && taskId !== null;
  const [queryActivationState, setQueryActivationState] = useState<{
    enabled: boolean;
    since: number;
  }>(() => ({
    enabled: queryEnabled,
    since: queryEnabled ? Date.now() : 0,
  }));

  const taskMemoryKey = repoPath && taskId ? buildTaskMemoryKey(repoPath, taskId) : null;
  const queryOptions =
    repoPath && taskId
      ? devServerGroupStateQueryOptions(repoPath, taskId)
      : devServerGroupStateQueryOptions("__disabled__", "__disabled__");
  const stateQuery = useQuery({
    ...queryOptions,
    enabled: queryEnabled,
  });

  const {
    applyTerminalBuffersFromEvent,
    beginMutationReplaySync,
    cancelMutationReplaySync,
    clearTerminalBuffers,
    hydrateTerminalBuffersFromState,
    markMutationReplayObserved,
    replaceTerminalBuffersFromState,
    selectedScriptTerminalBuffer,
    syncSelectedScriptTerminalBuffer,
    syncTerminalBuffersFromMutationState,
  } = useAgentStudioDevServerTerminalBuffers();

  useEffect(() => {
    setQueryActivationState((current) => {
      if (current.enabled === queryEnabled) {
        return current;
      }

      return {
        enabled: queryEnabled,
        since: queryEnabled ? Date.now() : 0,
      };
    });
  }, [queryEnabled]);

  useEffect(() => {
    if (!queryEnabled || repoPath === null || taskId === null) {
      return;
    }

    if (stateQuery.isFetching || stateQuery.dataUpdatedAt >= queryActivationState.since) {
      return;
    }

    void stateQuery.refetch();
  }, [
    queryActivationState.since,
    queryEnabled,
    repoPath,
    stateQuery,
    stateQuery.dataUpdatedAt,
    stateQuery.isFetching,
    taskId,
  ]);

  const shouldUseQueryData =
    queryEnabled && stateQuery.data !== undefined && queryActivationState.enabled === queryEnabled;
  const currentLiveState = queryEnabled ? liveState : null;
  const effectiveState =
    currentLiveState ?? (shouldUseQueryData ? (stateQuery.data ?? null) : null);
  const isAwaitingFreshState =
    queryEnabled &&
    effectiveState == null &&
    !stateQuery.error &&
    (stateQuery.isPending || stateQuery.isFetching || stateQuery.data !== undefined);

  const { effectiveSelectedScriptId, onSelectScript, resetSelectedScript, selectedScriptIdRef } =
    useAgentStudioDevServerPanelSelection({
      taskMemoryKey,
      scripts: effectiveState?.scripts ?? [],
      syncSelectedScriptTerminalBuffer,
    });

  const requestTerminalRehydrate = useCallback((): void => {
    if (!repoPath || !taskId) {
      return;
    }

    forceHydrateFromQueryRef.current = true;
    void queryClient.refetchQueries({
      queryKey: devServerQueryKeys.state(repoPath, taskId),
      exact: true,
      type: "active",
    });
  }, [queryClient, repoPath, taskId]);

  const syncStateFromEvent = useCallback(
    (event: DevServerEvent): void => {
      if (!repoPath || !taskId) {
        return;
      }

      markMutationReplayObserved(event);
      applyTerminalBuffersFromEvent(event, selectedScriptIdRef.current);

      if (event.type !== "terminal_chunk") {
        const queryKey = devServerQueryKeys.state(repoPath, taskId);
        const cachedState = queryClient.getQueryData<DevServerGroupState>(queryKey) ?? null;
        dispatchLocalState({
          type: "liveStateUpdated",
          update: (current) => {
            const scopedCurrent =
              current && current.repoPath === repoPath && current.taskId === taskId
                ? current
                : null;
            const nextState = applyDevServerEventToState(cachedState ?? scopedCurrent, event);
            if (nextState) {
              queryClient.setQueryData(queryKey, nextState);
            }
            return nextState;
          },
        });
      }
    },
    [
      applyTerminalBuffersFromEvent,
      markMutationReplayObserved,
      queryClient,
      repoPath,
      selectedScriptIdRef,
      taskId,
    ],
  );

  useEffect(() => {
    const scopeChanged = previousTaskMemoryKeyRef.current !== taskMemoryKey;
    previousTaskMemoryKeyRef.current = taskMemoryKey;

    if (scopeChanged) {
      clearTerminalBuffers();
      forceHydrateFromQueryRef.current = false;
      resetSelectedScript();
      dispatchLocalState({ type: "scopeReset" });
    }

    if (!queryEnabled) {
      clearTerminalBuffers();
      forceHydrateFromQueryRef.current = false;
      resetSelectedScript();
      dispatchLocalState({ type: "scopeReset" });
      return;
    }

    if (queryActivationState.enabled === queryEnabled && stateQuery.data) {
      hydrateTerminalBuffersFromState(
        stateQuery.data,
        selectedScriptIdRef.current,
        forceHydrateFromQueryRef.current,
      );
      forceHydrateFromQueryRef.current = false;
      dispatchLocalState({ type: "liveStateChanged", state: stateQuery.data });
    }
  }, [
    clearTerminalBuffers,
    hydrateTerminalBuffersFromState,
    queryActivationState.enabled,
    queryEnabled,
    resetSelectedScript,
    selectedScriptIdRef,
    stateQuery.data,
    taskMemoryKey,
  ]);

  const syncQueryState = useCallback(
    (nextState: DevServerGroupState): void => {
      syncTerminalBuffersFromMutationState(nextState, selectedScriptIdRef.current);
      dispatchLocalState({ type: "liveStateChanged", state: nextState });
    },
    [selectedScriptIdRef, syncTerminalBuffersFromMutationState],
  );

  const restoreCachedState = useCallback((): void => {
    if (!repoPath || !taskId) {
      return;
    }

    const cachedState =
      queryClient.getQueryData<DevServerGroupState>(devServerQueryKeys.state(repoPath, taskId)) ??
      null;
    replaceTerminalBuffersFromState(cachedState, selectedScriptIdRef.current);
    dispatchLocalState({ type: "liveStateChanged", state: cachedState });
  }, [queryClient, repoPath, replaceTerminalBuffersFromState, selectedScriptIdRef, taskId]);

  const invalidateState = useCallback((): void => {
    if (!repoPath || !taskId) {
      return;
    }

    void queryClient.invalidateQueries({
      queryKey: devServerQueryKeys.state(repoPath, taskId),
      exact: true,
      refetchType: "active",
    });
  }, [queryClient, repoPath, taskId]);

  const startMutation = useMutation({
    mutationFn: async (): Promise<DevServerGroupState> => {
      if (!repoPath || !taskId) {
        throw new Error("Builder dev servers require an active repository and task.");
      }

      return hostClient.devServerStart(repoPath, taskId);
    },
    onMutate: () => {
      dispatchLocalState({ type: "actionStarted" });
      beginMutationReplaySync(effectiveState);
    },
    onSuccess: (data) => {
      if (repoPath && taskId) {
        queryClient.setQueryData(devServerQueryKeys.state(repoPath, taskId), data);
      }
      syncQueryState(data);
    },
    onError: (error: unknown) => {
      cancelMutationReplaySync();
      restoreCachedState();
      dispatchLocalState({ type: "actionFailed", error: errorMessage(error) });
    },
    onSettled: (_data, error) => {
      if (error) {
        invalidateState();
      }
    },
  });

  const stopMutation = useMutation({
    mutationFn: async (): Promise<DevServerGroupState> => {
      if (!repoPath || !taskId) {
        throw new Error("Builder dev servers require an active repository and task.");
      }

      return hostClient.devServerStop(repoPath, taskId);
    },
    onMutate: () => {
      dispatchLocalState({ type: "actionStarted" });
      beginMutationReplaySync(effectiveState);
    },
    onSuccess: (data) => {
      if (repoPath && taskId) {
        queryClient.setQueryData(devServerQueryKeys.state(repoPath, taskId), data);
      }
      syncQueryState(data);
    },
    onError: (error: unknown) => {
      cancelMutationReplaySync();
      dispatchLocalState({ type: "actionFailed", error: errorMessage(error) });
    },
    onSettled: (_data, error) => {
      if (error) {
        invalidateState();
      }
    },
  });

  const restartMutation = useMutation({
    mutationFn: async (): Promise<DevServerGroupState> => {
      if (!repoPath || !taskId) {
        throw new Error("Builder dev servers require an active repository and task.");
      }

      return hostClient.devServerRestart(repoPath, taskId);
    },
    onMutate: () => {
      dispatchLocalState({ type: "actionStarted" });
      beginMutationReplaySync(effectiveState);
    },
    onSuccess: (data) => {
      if (repoPath && taskId) {
        queryClient.setQueryData(devServerQueryKeys.state(repoPath, taskId), data);
      }
      syncQueryState(data);
    },
    onError: (error: unknown) => {
      cancelMutationReplaySync();
      dispatchLocalState({ type: "actionFailed", error: errorMessage(error) });
    },
    onSettled: (_data, error) => {
      if (error) {
        invalidateState();
      }
    },
  });

  useEffect(() => {
    if (!queryEnabled || repoPath === null || taskId === null) {
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void subscribeDevServerEvents((payload) => {
      if (isDevServerSubscriptionControlEvent(payload)) {
        requestTerminalRehydrate();
        return;
      }

      const parsed = devServerEventSchema.safeParse(payload);
      if (!parsed.success) {
        console.error(
          "[agent-studio-dev-server-panel] Received invalid dev server event payload.",
          {
            payload,
            error: parsed.error,
          },
        );
        dispatchLocalState({
          type: "subscriptionFailed",
          error: `Received invalid dev server event payload: ${errorMessage(parsed.error)}`,
        });
        return;
      }

      const event = parsed.data;
      if (event.type !== "snapshot" && (event.repoPath !== repoPath || event.taskId !== taskId)) {
        return;
      }
      if (
        event.type === "snapshot" &&
        (event.state.repoPath !== repoPath || event.state.taskId !== taskId)
      ) {
        return;
      }

      syncStateFromEvent(event);
      dispatchLocalState({ type: "eventsSynced" });
    })
      .then((cleanup) => {
        if (cancelled) {
          cleanup();
          return;
        }

        unsubscribe = cleanup;
        dispatchLocalState({ type: "subscriptionReady" });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          dispatchLocalState({ type: "subscriptionFailed", error: errorMessage(error) });
        }
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [queryEnabled, repoPath, requestTerminalRehydrate, syncStateFromEvent, taskId]);

  const selectedScript =
    effectiveState?.scripts.find((script) => script.scriptId === effectiveSelectedScriptId) ?? null;
  const isExpanded = isDevServerPanelExpanded(
    effectiveState?.scripts ?? [],
    startMutation.isPending || restartMutation.isPending,
  );
  const hasAvailableScripts = (effectiveState?.scripts.length ?? 0) > 0 || hasConfiguredScripts;

  const mode: AgentStudioDevServerPanelMode = useMemo(() => {
    if (!hasAvailableScripts) {
      return "empty";
    }

    if (isAwaitingFreshState) {
      return "loading";
    }

    if (!effectiveState?.worktreePath) {
      return "disabled";
    }

    if (isExpanded) {
      return "active";
    }

    return "stopped";
  }, [effectiveState, hasAvailableScripts, isAwaitingFreshState, isExpanded]);

  const error =
    actionError ?? subscriptionError ?? (stateQuery.error ? errorMessage(stateQuery.error) : null);
  let disabledReason: string | null = null;

  if (mode === "disabled") {
    disabledReason = DEV_SERVER_DISABLED_REASON;
  } else if (mode === "empty") {
    disabledReason = DEV_SERVER_EMPTY_REASON;
  }

  return {
    mode,
    isExpanded,
    isLoading: isAwaitingFreshState || stateQuery.isLoading,
    disabledReason,
    repoPath,
    taskId,
    worktreePath: effectiveState?.worktreePath ?? null,
    scripts: effectiveState?.scripts ?? [],
    selectedScriptId: effectiveSelectedScriptId,
    selectedScript,
    selectedScriptTerminalBuffer,
    error,
    isStartPending: startMutation.isPending,
    isStopPending: stopMutation.isPending,
    isRestartPending: restartMutation.isPending,
    onSelectScript,
    onStart: () => {
      dispatchLocalState({ type: "actionStarted" });
      if (effectiveState) {
        const optimisticState = buildOptimisticStartingState(effectiveState);
        replaceTerminalBuffersFromState(optimisticState, selectedScriptIdRef.current);
        dispatchLocalState({ type: "liveStateChanged", state: optimisticState });
      }
      startMutation.mutate();
    },
    onStop: () => {
      stopMutation.mutate();
    },
    onRestart: () => {
      restartMutation.mutate();
    },
  };
}
