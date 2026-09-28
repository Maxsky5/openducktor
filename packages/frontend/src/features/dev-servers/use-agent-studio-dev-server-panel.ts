import type { DevServerGroupState, DevServerOwner } from "@openducktor/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { type Dispatch, useCallback, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import {
  type AgentStudioDevServerPanelMode,
  type AgentStudioDevServerPanelModel,
  DEV_SERVER_DISABLED_REASON,
  DEV_SERVER_EMPTY_REASON,
} from "@/components/features/agents/agent-studio-dev-server-panel";
import { errorMessage } from "@/lib/errors";
import { devServerQueryKeys } from "@/state/queries/dev-servers";
import {
  createDevServerScope,
  type DevServerScope,
  formatDevServerScopeKey,
} from "@/types/dev-server-scope";
import { isDevServerPanelExpanded } from "./use-agent-studio-dev-server-panel-helpers";
import {
  devServerAction,
  useDevServerMutations,
} from "./use-agent-studio-dev-server-panel-mutations";
import { useAgentStudioDevServerPanelSelection } from "./use-agent-studio-dev-server-panel-selection";
import {
  type DevServerPanelAction,
  devServerPanelReducer,
  type TerminalBuffers,
  useDevServerEventStateSync,
  useDevServerQueryHydration,
  useDevServerSubscription,
} from "./use-agent-studio-dev-server-panel-state";
import { useAgentStudioDevServerStateQuery } from "./use-agent-studio-dev-server-state-query";
import { useAgentStudioDevServerTerminalBuffers } from "./use-agent-studio-dev-server-terminal-buffers";

export {
  applyDevServerEventToState,
  isDevServerPanelExpanded,
  selectDefaultDevServerTab,
} from "./use-agent-studio-dev-server-panel-helpers";

type UseAgentStudioDevServerPanelArgs = {
  repoPath: string | null;
  owner: DevServerOwner | null;
  enabled: boolean;
};

type DevServerLayoutMemory = {
  byScope: Map<string, boolean>;
  byRepo: Map<string, boolean>;
};

// Keep the dock's shape across tab unmounts while fresh state and logs load for the new owner.
const layoutByClient = new WeakMap<QueryClient, DevServerLayoutMemory>();

export function useAgentStudioDevServerPanel({
  repoPath,
  owner,
  enabled,
}: UseAgentStudioDevServerPanelArgs): AgentStudioDevServerPanelModel {
  const queryClient = useQueryClient();
  const layoutMemory = getLayoutMemory(queryClient);
  const [localState, dispatchLocalState] = useReducer(devServerPanelReducer, {
    liveState: null,
    actionError: null,
    subscriptionError: null,
    subscribedScopeKey: null,
    transportEpoch: null,
  });
  const [retryCount, retrySubscription] = useReducer((count: number) => count + 1, 0);
  const { liveState, actionError, subscriptionError, subscribedScopeKey, transportEpoch } =
    localState;
  const transportEpochRef = useRef(transportEpoch);

  const subscriptionEnabled = enabled && repoPath !== null && owner !== null;
  const activeScope = useMemo(() => createDevServerScope(repoPath, owner), [repoPath, owner]);
  const scopeKey = activeScope ? formatDevServerScopeKey(activeScope) : null;
  const queryEnabled =
    subscriptionEnabled &&
    scopeKey !== null &&
    scopeKey === subscribedScopeKey &&
    transportEpoch !== null;
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
  } = useAgentStudioDevServerTerminalBuffers(activeScope);

  const { effectiveState, isAwaitingFreshState, queryData, stateQuery } =
    useAgentStudioDevServerStateQuery({
      repoPath,
      owner,
      queryEnabled,
      liveState,
      transportEpoch,
    });
  const { refetch: refetchState } = stateQuery;

  const { effectiveSelectedScriptId, onSelectScript, resetSelectedScript, selectedScriptIdRef } =
    useAgentStudioDevServerPanelSelection({
      scopeKey,
      scripts: effectiveState?.scripts ?? [],
      syncSelectedScriptTerminalBuffer,
    });

  const requestTerminalRehydrate = useCallback((): void => {
    const activeTransportEpoch = transportEpochRef.current;
    if (!repoPath || !owner || !activeTransportEpoch) {
      return;
    }

    void queryClient.refetchQueries({
      queryKey: devServerQueryKeys.state(repoPath, owner, activeTransportEpoch),
      exact: true,
      type: "active",
    });
  }, [queryClient, repoPath, owner]);

  const syncStateFromEvent = useDevServerEventStateSync({
    applyTerminalBuffersFromEvent,
    dispatchLocalState,
    markMutationReplayObserved,
    owner,
    queryClient,
    repoPath,
    selectedScriptIdRef,
    transportEpochRef,
  });

  useDevServerQueryHydration({
    clearTerminalBuffers,
    dispatchLocalState,
    effectiveSelectedScriptId,
    effectiveState,
    hydrateTerminalBuffersFromState,
    scopeKey,
    queryData,
    queryEnabled,
    resetSelectedScript,
    subscriptionEnabled,
    transportEpochRef,
  });

  const { startMutation, stopMutation, restartMutation, isActiveMutationScope } =
    useDevServerMutations({
      activeScope,
      beginMutationReplaySync,
      cancelMutationReplaySync,
      dispatchLocalState,
      effectiveState,
      owner,
      queryClient,
      repoPath,
      replaceTerminalBuffersFromState,
      selectedScriptIdRef,
      syncTerminalBuffersFromMutationState,
      transportEpochRef,
    });

  useDevServerSubscription({
    clearTerminalBuffers,
    dispatchLocalState,
    owner,
    scopeKey,
    repoPath,
    requestTerminalRehydrate,
    retryCount,
    subscriptionEnabled,
    syncStateFromEvent,
    transportEpochRef,
  });

  const onRetry = useCallback((): void => {
    dispatchLocalState({ type: "retryStarted" });
    if (subscriptionError !== null || !queryEnabled) {
      retrySubscription();
      return;
    }
    void refetchState();
  }, [queryEnabled, refetchState, subscriptionError]);

  const model = createDevServerPanelModel({
    activeScope,
    actionError,
    keepDockOpen: scopeKey
      ? (layoutMemory.byScope.get(scopeKey) ?? layoutMemory.byRepo.get(repoPath ?? "") ?? false)
      : false,
    dispatchLocalState,
    effectiveSelectedScriptId,
    effectiveState,
    isActiveMutationScope,
    isAwaitingFreshState,
    onSelectScript,
    onRetry,
    owner,
    queryEnabled,
    repoPath,
    restartMutation,
    selectedScriptTerminalBuffer,
    startMutation,
    stateQuery,
    stopMutation,
    subscriptionEnabled,
    subscriptionError,
    transportEpoch,
  });
  useLayoutEffect(() => {
    if (scopeKey && subscriptionEnabled && !model.isLoading) {
      layoutMemory.byScope.set(scopeKey, model.isExpanded);
      if (repoPath) layoutMemory.byRepo.set(repoPath, model.isExpanded);
    }
  }, [layoutMemory, model.isExpanded, model.isLoading, repoPath, scopeKey, subscriptionEnabled]);
  return model;
}

const createDevServerPanelModel = ({
  activeScope,
  actionError,
  keepDockOpen,
  dispatchLocalState,
  effectiveSelectedScriptId,
  effectiveState,
  isActiveMutationScope,
  isAwaitingFreshState,
  onSelectScript,
  onRetry,
  owner,
  queryEnabled,
  repoPath,
  restartMutation,
  selectedScriptTerminalBuffer,
  startMutation,
  stateQuery,
  stopMutation,
  subscriptionEnabled,
  subscriptionError,
  transportEpoch,
}: {
  activeScope: DevServerScope | null;
  actionError: string | null;
  keepDockOpen: boolean;
  dispatchLocalState: Dispatch<DevServerPanelAction>;
  effectiveSelectedScriptId: string | null;
  effectiveState: DevServerGroupState | null;
  isActiveMutationScope: ReturnType<typeof useDevServerMutations>["isActiveMutationScope"];
  isAwaitingFreshState: boolean;
  onSelectScript: (scriptId: string) => void;
  onRetry: () => void;
  owner: DevServerOwner | null;
  queryEnabled: boolean;
  repoPath: string | null;
  restartMutation: ReturnType<typeof useDevServerMutations>["restartMutation"];
  selectedScriptTerminalBuffer: TerminalBuffers["selectedScriptTerminalBuffer"];
  startMutation: ReturnType<typeof useDevServerMutations>["startMutation"];
  stateQuery: ReturnType<typeof useAgentStudioDevServerStateQuery>["stateQuery"];
  stopMutation: ReturnType<typeof useDevServerMutations>["stopMutation"];
  subscriptionEnabled: boolean;
  subscriptionError: string | null;
  transportEpoch: string | null;
}): AgentStudioDevServerPanelModel => {
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
  const isAwaitingSubscription = subscriptionEnabled && !queryEnabled && subscriptionError === null;
  const error =
    actionError ?? subscriptionError ?? (stateQuery.error ? errorMessage(stateQuery.error) : null);
  const isLoading = isAwaitingSubscription || isAwaitingFreshState || stateQuery.isLoading;
  const isExpanded =
    isDevServerPanelExpanded(effectiveState?.scripts ?? [], isStartPending || isRestartPending) ||
    (effectiveState === null && error === null && isLoading && keepDockOpen);
  const mode = pickPanelMode({
    isAwaitingSubscription,
    isAwaitingFreshState,
    effectiveState,
    isExpanded,
    subscriptionEnabled,
    hasError: error !== null,
  });

  return {
    mode,
    isExpanded,
    isLoading,
    disabledReason: pickDisabledReason(mode, owner),
    repoPath,
    owner,
    workingDirectory: effectiveState?.workingDirectory ?? null,
    scripts: effectiveState?.scripts ?? [],
    selectedScriptId: effectiveSelectedScriptId,
    selectedScript,
    selectedScriptTerminalBuffer,
    error,
    isStartPending,
    isRetryPending: stateQuery.isFetching && mode === "error",
    isStopPending,
    isRestartPending,
    onSelectScript,
    onStart: devServerAction(activeScope, dispatchLocalState, startMutation.mutate),
    onRetry,
    onStop: devServerAction(activeScope, dispatchLocalState, stopMutation.mutate),
    onRestart: devServerAction(activeScope, dispatchLocalState, restartMutation.mutate),
  };
};

const getLayoutMemory = (queryClient: QueryClient): DevServerLayoutMemory => {
  let memory = layoutByClient.get(queryClient);
  if (!memory) {
    memory = { byScope: new Map(), byRepo: new Map() };
    layoutByClient.set(queryClient, memory);
  }
  return memory;
};

const pickPanelMode = ({
  isAwaitingSubscription,
  isAwaitingFreshState,
  effectiveState,
  isExpanded,
  subscriptionEnabled,
  hasError,
}: {
  isAwaitingSubscription: boolean;
  isAwaitingFreshState: boolean;
  effectiveState: DevServerGroupState | null;
  isExpanded: boolean;
  subscriptionEnabled: boolean;
  hasError: boolean;
}): AgentStudioDevServerPanelMode => {
  if (!subscriptionEnabled) return "disabled";
  if (hasError && !effectiveState) return "error";
  if (isAwaitingSubscription || isAwaitingFreshState) return "loading";
  if (!effectiveState) return "loading";
  if (effectiveState.scripts.length === 0) return "empty";
  if (!effectiveState.workingDirectory) return "disabled";
  return isExpanded ? "active" : "stopped";
};

const pickDisabledReason = (
  mode: AgentStudioDevServerPanelMode,
  owner: DevServerOwner | null,
): string | null => {
  if (mode === "empty") return DEV_SERVER_EMPTY_REASON;
  if (mode !== "disabled") return null;
  return owner?.kind === "workspace_session"
    ? "This Workspace Session directory is unavailable. Restore the worktree or reload the session."
    : DEV_SERVER_DISABLED_REASON;
};
