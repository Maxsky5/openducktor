import type { DevServerEvent, DevServerGroupState } from "@openducktor/contracts";
import { devServerEventSchema } from "@openducktor/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  type AgentStudioDevServerPanelMode,
  type AgentStudioDevServerPanelModel,
  DEV_SERVER_DISABLED_REASON,
  DEV_SERVER_EMPTY_REASON,
} from "@/components/features/agents/agent-studio-dev-server-panel";
import { BROWSER_LIVE_RECONNECTED_EVENT_KIND } from "@/lib/browser-live/constants";
import { errorMessage } from "@/lib/errors";
import { hostClient, subscribeDevServerEvents } from "@/lib/host-client";
import { devServerQueryKeys } from "@/state/queries/dev-servers";
import {
  createDevServerTaskScope,
  type DevServerTaskScope,
  isSameDevServerTaskScope,
  MISSING_DEV_SERVER_TASK_SCOPE_MESSAGE,
} from "@/types/dev-server-task-scope";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  applyDevServerEventToState,
  buildTaskMemoryKey,
  isDevServerPanelExpanded,
  isDevServerSubscriptionControlEvent,
} from "./use-agent-studio-dev-server-panel-helpers";
import { useAgentStudioDevServerPanelSelection } from "./use-agent-studio-dev-server-panel-selection";
import { useAgentStudioDevServerStateQuery } from "./use-agent-studio-dev-server-state-query";
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

type DevServerMutationCommand = (scope: DevServerTaskScope) => Promise<DevServerGroupState>;

type DevServerMutationOptions = {
  restoreCachedStateOnError?: boolean;
};

type DevServerMutationContext = {
  transportEpoch: string | null;
};

type DevServerPanelLocalState = {
  liveState: DevServerGroupState | null;
  actionError: string | null;
  subscriptionError: string | null;
  subscriptionTaskMemoryKey: string | null;
  transportEpoch: string | null;
};

type DevServerPanelAction =
  | { type: "scopeReset" }
  | { type: "transportReconnected"; transportEpoch: string }
  | { type: "liveStateChanged"; state: DevServerGroupState | null }
  | {
      type: "liveStateUpdated";
      update: (current: DevServerGroupState | null) => DevServerGroupState | null;
    }
  | { type: "actionStarted" }
  | { type: "actionFailed"; error: string }
  | { type: "subscriptionFailed"; error: string }
  | { type: "eventsSynced" }
  | { type: "subscriptionReady"; taskMemoryKey: string; transportEpoch: string };

const devServerPanelReducer = (
  state: DevServerPanelLocalState,
  action: DevServerPanelAction,
): DevServerPanelLocalState => {
  switch (action.type) {
    case "scopeReset":
      return {
        ...state,
        liveState: null,
        actionError: null,
        subscriptionError: null,
        subscriptionTaskMemoryKey: null,
        transportEpoch: null,
      };
    case "transportReconnected":
      return {
        ...state,
        liveState: null,
        subscriptionError: null,
        transportEpoch: action.transportEpoch,
      };
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
      return {
        ...state,
        subscriptionError: null,
        subscriptionTaskMemoryKey: action.taskMemoryKey,
        transportEpoch: action.transportEpoch,
      };
  }
};

export function useAgentStudioDevServerPanel({
  repoPath,
  taskId,
  repoSettings,
  enabled,
}: UseAgentStudioDevServerPanelArgs): AgentStudioDevServerPanelModel {
  const queryClient = useQueryClient();
  const previousTaskMemoryKeyRef = useRef<string | null | undefined>(undefined);
  const [localState, dispatchLocalState] = useReducer(devServerPanelReducer, {
    liveState: null,
    actionError: null,
    subscriptionError: null,
    subscriptionTaskMemoryKey: null,
    transportEpoch: null,
  });
  const { liveState, actionError, subscriptionError, subscriptionTaskMemoryKey, transportEpoch } =
    localState;
  const transportEpochRef = useRef(transportEpoch);

  const configuredScripts = repoSettings?.devServers ?? [];
  const hasConfiguredScripts = configuredScripts.length > 0;
  const subscriptionEnabled =
    enabled && hasConfiguredScripts && repoPath !== null && taskId !== null;
  const taskMemoryKey = repoPath && taskId ? buildTaskMemoryKey(repoPath, taskId) : null;
  const queryEnabled =
    subscriptionEnabled &&
    taskMemoryKey !== null &&
    taskMemoryKey === subscriptionTaskMemoryKey &&
    transportEpoch !== null;
  const activeTaskScope = useMemo(
    () => createDevServerTaskScope(repoPath, taskId),
    [repoPath, taskId],
  );

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
  } = useAgentStudioDevServerTerminalBuffers(activeTaskScope);

  const { effectiveState, isAwaitingFreshState, queryData, stateQuery } =
    useAgentStudioDevServerStateQuery({
      repoPath,
      taskId,
      queryEnabled,
      liveState,
      transportEpoch,
    });

  const { effectiveSelectedScriptId, onSelectScript, resetSelectedScript, selectedScriptIdRef } =
    useAgentStudioDevServerPanelSelection({
      taskMemoryKey,
      scripts: effectiveState?.scripts ?? [],
      syncSelectedScriptTerminalBuffer,
    });

  const requestTerminalRehydrate = useCallback((): void => {
    const activeTransportEpoch = transportEpochRef.current;
    if (!repoPath || !taskId || !activeTransportEpoch) {
      return;
    }

    void queryClient.refetchQueries({
      queryKey: devServerQueryKeys.state(repoPath, taskId, activeTransportEpoch),
      exact: true,
      type: "active",
    });
  }, [queryClient, repoPath, taskId]);

  const syncStateFromEvent = useCallback(
    (event: DevServerEvent): void => {
      const activeTransportEpoch = transportEpochRef.current;
      if (!repoPath || !taskId || !activeTransportEpoch) {
        return;
      }

      if (!applyTerminalBuffersFromEvent(event, selectedScriptIdRef.current)) {
        return;
      }
      markMutationReplayObserved(event);

      if (event.type !== "terminal_chunk") {
        const queryKey = devServerQueryKeys.state(repoPath, taskId, activeTransportEpoch);
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
      transportEpochRef.current = null;
      resetSelectedScript();
      dispatchLocalState({ type: "scopeReset" });
    }

    if (!subscriptionEnabled) {
      transportEpochRef.current = null;
      clearTerminalBuffers();
      resetSelectedScript();
      dispatchLocalState({ type: "scopeReset" });
      return;
    }

    if (queryEnabled && queryData) {
      if (hydrateTerminalBuffersFromState(queryData, effectiveSelectedScriptId)) {
        dispatchLocalState({ type: "liveStateChanged", state: queryData });
      }
    }
  }, [
    clearTerminalBuffers,
    effectiveSelectedScriptId,
    hydrateTerminalBuffersFromState,
    queryData,
    queryEnabled,
    resetSelectedScript,
    subscriptionEnabled,
    taskMemoryKey,
  ]);

  const syncQueryState = useCallback(
    (nextState: DevServerGroupState): boolean => {
      if (!syncTerminalBuffersFromMutationState(nextState, selectedScriptIdRef.current)) {
        return false;
      }
      dispatchLocalState({ type: "liveStateChanged", state: nextState });
      return true;
    },
    [selectedScriptIdRef, syncTerminalBuffersFromMutationState],
  );

  const isActiveMutationScope = useCallback(
    (scope: DevServerTaskScope | null | undefined): boolean => {
      return isSameDevServerTaskScope(scope ?? null, activeTaskScope);
    },
    [activeTaskScope],
  );

  const syncMutationSuccessState = useCallback(
    (nextState: DevServerGroupState, mutationTransportEpoch: string): void => {
      const isActiveState = nextState.repoPath === repoPath && nextState.taskId === taskId;
      if (isActiveState && !syncQueryState(nextState)) {
        return;
      }
      queryClient.setQueryData(
        devServerQueryKeys.state(nextState.repoPath, nextState.taskId, mutationTransportEpoch),
        nextState,
      );
    },
    [queryClient, repoPath, syncQueryState, taskId],
  );

  const restoreCachedState = useCallback(
    (mutationTransportEpoch: string): void => {
      if (!repoPath || !taskId) {
        return;
      }

      const cachedState =
        queryClient.getQueryData<DevServerGroupState>(
          devServerQueryKeys.state(repoPath, taskId, mutationTransportEpoch),
        ) ?? null;
      if (replaceTerminalBuffersFromState(cachedState, selectedScriptIdRef.current)) {
        dispatchLocalState({ type: "liveStateChanged", state: cachedState });
      }
    },
    [queryClient, repoPath, replaceTerminalBuffersFromState, selectedScriptIdRef, taskId],
  );

  const invalidateState = useCallback(
    (scope: DevServerTaskScope, mutationTransportEpoch: string): void => {
      void queryClient.invalidateQueries({
        queryKey: devServerQueryKeys.state(scope.repoPath, scope.taskId, mutationTransportEpoch),
        exact: true,
        refetchType: "active",
      });
    },
    [queryClient],
  );

  const createScopedMutationOptions = useCallback(
    (mutationFn: DevServerMutationCommand, options: DevServerMutationOptions = {}) => ({
      mutationFn,
      onMutate: (scope: DevServerTaskScope) => {
        if (isActiveMutationScope(scope)) {
          dispatchLocalState({ type: "actionStarted" });
          beginMutationReplaySync(effectiveState);
        }
        return {
          transportEpoch: transportEpochRef.current,
        } satisfies DevServerMutationContext;
      },
      onSuccess: (
        data: DevServerGroupState,
        _scope: DevServerTaskScope,
        context: DevServerMutationContext | undefined,
      ) => {
        if (!context?.transportEpoch || context.transportEpoch !== transportEpochRef.current) {
          return;
        }
        syncMutationSuccessState(data, context.transportEpoch);
      },
      onError: (
        error: unknown,
        scope: DevServerTaskScope,
        context: DevServerMutationContext | undefined,
      ) => {
        if (!context?.transportEpoch || context.transportEpoch !== transportEpochRef.current) {
          return;
        }
        if (isActiveMutationScope(scope)) {
          cancelMutationReplaySync();
          if (options.restoreCachedStateOnError) {
            restoreCachedState(context.transportEpoch);
          }
          dispatchLocalState({ type: "actionFailed", error: errorMessage(error) });
        }
      },
      onSettled: (
        _data: DevServerGroupState | undefined,
        error: unknown,
        scope: DevServerTaskScope,
        context: DevServerMutationContext | undefined,
      ) => {
        if (
          error &&
          context?.transportEpoch &&
          context.transportEpoch === transportEpochRef.current
        ) {
          invalidateState(scope, context.transportEpoch);
        }
      },
    }),
    [
      beginMutationReplaySync,
      cancelMutationReplaySync,
      effectiveState,
      invalidateState,
      isActiveMutationScope,
      restoreCachedState,
      syncMutationSuccessState,
    ],
  );

  const startMutation = useMutation<
    DevServerGroupState,
    unknown,
    DevServerTaskScope,
    DevServerMutationContext
  >(
    createScopedMutationOptions(
      async (scope): Promise<DevServerGroupState> =>
        hostClient.devServerStart(scope.repoPath, scope.taskId),
      { restoreCachedStateOnError: true },
    ),
  );

  const stopMutation = useMutation<
    DevServerGroupState,
    unknown,
    DevServerTaskScope,
    DevServerMutationContext
  >(
    createScopedMutationOptions(
      async (scope): Promise<DevServerGroupState> =>
        hostClient.devServerStop(scope.repoPath, scope.taskId),
    ),
  );

  const restartMutation = useMutation<
    DevServerGroupState,
    unknown,
    DevServerTaskScope,
    DevServerMutationContext
  >(
    createScopedMutationOptions(
      async (scope): Promise<DevServerGroupState> =>
        hostClient.devServerRestart(scope.repoPath, scope.taskId),
    ),
  );

  useEffect(() => {
    if (!subscriptionEnabled || repoPath === null || taskId === null || taskMemoryKey === null) {
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void subscribeDevServerEvents((payload) => {
      if (cancelled) {
        return;
      }

      if (isDevServerSubscriptionControlEvent(payload)) {
        if (payload.kind === BROWSER_LIVE_RECONNECTED_EVENT_KIND) {
          transportEpochRef.current = payload.transportEpoch;
          clearTerminalBuffers();
          dispatchLocalState({
            type: "transportReconnected",
            transportEpoch: payload.transportEpoch,
          });
          return;
        }
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
      .then((subscription) => {
        if (cancelled) {
          subscription.unsubscribe();
          return;
        }

        unsubscribe = subscription.unsubscribe;
        transportEpochRef.current = subscription.transportEpoch;
        clearTerminalBuffers();
        dispatchLocalState({
          type: "subscriptionReady",
          taskMemoryKey,
          transportEpoch: subscription.transportEpoch,
        });
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
  }, [
    clearTerminalBuffers,
    repoPath,
    requestTerminalRehydrate,
    subscriptionEnabled,
    syncStateFromEvent,
    taskId,
    taskMemoryKey,
  ]);

  const selectedScript =
    effectiveState?.scripts.find((script) => script.scriptId === effectiveSelectedScriptId) ?? null;
  const isStartPending =
    startMutation.isPending &&
    startMutation.context?.transportEpoch === transportEpoch &&
    isActiveMutationScope(startMutation.variables);
  const isStopPending =
    stopMutation.isPending &&
    stopMutation.context?.transportEpoch === transportEpoch &&
    isActiveMutationScope(stopMutation.variables);
  const isRestartPending =
    restartMutation.isPending &&
    restartMutation.context?.transportEpoch === transportEpoch &&
    isActiveMutationScope(restartMutation.variables);
  const isExpanded = isDevServerPanelExpanded(
    effectiveState?.scripts ?? [],
    isStartPending || isRestartPending,
  );
  const hasAvailableScripts = (effectiveState?.scripts.length ?? 0) > 0 || hasConfiguredScripts;
  const isAwaitingSubscription = subscriptionEnabled && !queryEnabled && subscriptionError === null;

  const mode: AgentStudioDevServerPanelMode = useMemo(() => {
    if (!hasAvailableScripts) {
      return "empty";
    }

    if (isAwaitingSubscription || isAwaitingFreshState) {
      return "loading";
    }

    if (!effectiveState?.worktreePath) {
      return "disabled";
    }

    if (isExpanded) {
      return "active";
    }

    return "stopped";
  }, [
    effectiveState,
    hasAvailableScripts,
    isAwaitingFreshState,
    isAwaitingSubscription,
    isExpanded,
  ]);

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
    isLoading: isAwaitingSubscription || isAwaitingFreshState || stateQuery.isLoading,
    disabledReason,
    repoPath,
    taskId,
    worktreePath: effectiveState?.worktreePath ?? null,
    scripts: effectiveState?.scripts ?? [],
    selectedScriptId: effectiveSelectedScriptId,
    selectedScript,
    selectedScriptTerminalBuffer,
    error,
    isStartPending,
    isStopPending,
    isRestartPending,
    onSelectScript,
    onStart: () => {
      if (!activeTaskScope) {
        dispatchLocalState({ type: "actionFailed", error: MISSING_DEV_SERVER_TASK_SCOPE_MESSAGE });
        return;
      }

      startMutation.mutate(activeTaskScope);
    },
    onStop: () => {
      if (!activeTaskScope) {
        dispatchLocalState({ type: "actionFailed", error: MISSING_DEV_SERVER_TASK_SCOPE_MESSAGE });
        return;
      }

      stopMutation.mutate(activeTaskScope);
    },
    onRestart: () => {
      if (!activeTaskScope) {
        dispatchLocalState({ type: "actionFailed", error: MISSING_DEV_SERVER_TASK_SCOPE_MESSAGE });
        return;
      }

      restartMutation.mutate(activeTaskScope);
    },
  };
}
