import type {
  DevServerEvent,
  DevServerGroupState,
  DevServerScriptState,
} from "@openducktor/contracts";
import { devServerEventSchema } from "@openducktor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  AgentStudioDevServerPanelMode,
  AgentStudioDevServerPanelModel,
} from "@/components/features/agents/agent-studio-dev-server-panel";
import {
  type AgentStudioDevServerTerminalBuffer,
  appendDevServerTerminalChunk,
  createDevServerTerminalBufferStore,
  type DevServerTerminalBufferStore,
  getDevServerTerminalBuffer,
  getLatestBufferedTerminalSequence,
  replaceDevServerTerminalBuffer,
  syncDevServerTerminalBufferStore,
  trimDevServerTerminalChunks,
} from "@/features/agent-studio-build-tools/dev-server-log-buffer";
import { errorMessage } from "@/lib/errors";
import { hostClient, subscribeDevServerEvents } from "@/lib/host-client";
import { devServerGroupStateQueryOptions, devServerQueryKeys } from "@/state/queries/dev-servers";
import type { RepoSettingsInput } from "@/types/state-slices";

type UseAgentStudioDevServerPanelArgs = {
  repoPath: string | null;
  taskId: string | null;
  repoSettings: RepoSettingsInput | null;
  enabled: boolean;
};

type SelectedScriptMemory = Map<string, string>;

type DevServerSubscriptionControlEvent = {
  __openducktorBrowserLive: true;
  kind: "reconnected" | "stream-warning";
  message?: string;
};

type PendingMutationReplaySync = {
  baselineByScriptId: Map<string, number | null>;
  observedScriptIds: Set<string>;
};

const buildTaskMemoryKey = (repoPath: string, taskId: string): string => `${repoPath}::${taskId}`;

const replaceScript = (
  scripts: DevServerScriptState[],
  nextScript: DevServerScriptState,
): DevServerScriptState[] =>
  scripts.map((script) => (script.scriptId === nextScript.scriptId ? nextScript : script));

const trimBufferedTerminalReplay = (script: DevServerScriptState): DevServerScriptState => ({
  ...script,
  bufferedTerminalChunks: trimDevServerTerminalChunks(script.bufferedTerminalChunks),
});

const isDevServerSubscriptionControlEvent = (
  payload: unknown,
): payload is DevServerSubscriptionControlEvent => {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    record.__openducktorBrowserLive === true &&
    (record.kind === "reconnected" || record.kind === "stream-warning")
  );
};

export const applyDevServerEventToState = (
  state: DevServerGroupState | null,
  event: DevServerEvent,
): DevServerGroupState | null => {
  if (event.type === "snapshot") {
    return {
      ...event.state,
      scripts: event.state.scripts.map(trimBufferedTerminalReplay),
    };
  }

  if (!state || state.repoPath !== event.repoPath || state.taskId !== event.taskId) {
    return state;
  }

  if (event.type === "script_status_changed") {
    return {
      ...state,
      updatedAt: event.updatedAt,
      scripts: replaceScript(state.scripts, trimBufferedTerminalReplay(event.script)),
    };
  }

  return {
    ...state,
    updatedAt: event.terminalChunk.timestamp,
    scripts: state.scripts,
  };
};

const toStartedAtMs = (script: DevServerScriptState): number => {
  if (!script.startedAt) {
    return 0;
  }

  const timestamp = Date.parse(script.startedAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

export const selectDefaultDevServerTab = (
  scripts: DevServerScriptState[],
  rememberedScriptId: string | null,
): string | null => {
  if (scripts.length === 0) {
    return null;
  }

  if (rememberedScriptId && scripts.some((script) => script.scriptId === rememberedScriptId)) {
    return rememberedScriptId;
  }

  let mostRecentlyActiveScript: DevServerScriptState | null = null;
  let mostRecentStartedAtMs = 0;

  for (const script of scripts) {
    const startedAtMs = toStartedAtMs(script);
    if (startedAtMs > mostRecentStartedAtMs) {
      mostRecentlyActiveScript = script;
      mostRecentStartedAtMs = startedAtMs;
    }
  }

  if (mostRecentlyActiveScript !== null) {
    return mostRecentlyActiveScript.scriptId;
  }

  return scripts[0]?.scriptId ?? null;
};

export const isDevServerPanelExpanded = (
  scripts: DevServerScriptState[],
  shouldKeepOpen: boolean,
): boolean => {
  if (shouldKeepOpen) {
    return true;
  }

  return scripts.some((script) => script.status !== "stopped");
};

export function useAgentStudioDevServerPanel({
  repoPath,
  taskId,
  repoSettings,
  enabled,
}: UseAgentStudioDevServerPanelArgs): AgentStudioDevServerPanelModel {
  const queryClient = useQueryClient();
  const selectionMemoryRef = useRef<SelectedScriptMemory>(new Map());
  const terminalBuffersRef = useRef<DevServerTerminalBufferStore>(
    createDevServerTerminalBufferStore(),
  );
  const forceHydrateFromQueryRef = useRef(false);
  const pendingMutationReplaySyncRef = useRef<PendingMutationReplaySync | null>(null);
  const previousTaskMemoryKeyRef = useRef<string | null | undefined>(undefined);
  const selectedScriptIdRef = useRef<string | null>(null);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [liveState, setLiveState] = useState<DevServerGroupState | null>(null);
  const [selectedScriptTerminalBuffer, setSelectedScriptTerminalBuffer] =
    useState<AgentStudioDevServerTerminalBuffer | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);

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

  const syncSelectedScriptTerminalBuffer = useCallback((scriptId: string | null): void => {
    setSelectedScriptTerminalBuffer(
      getDevServerTerminalBuffer(terminalBuffersRef.current, scriptId),
    );
  }, []);

  const hydrateTerminalBuffersFromState = useCallback(
    (state: DevServerGroupState | null, force = false): void => {
      if (!force && terminalBuffersRef.current.size > 0) {
        return;
      }

      syncDevServerTerminalBufferStore(terminalBuffersRef.current, state);
    },
    [],
  );

  const requestTerminalRehydrate = useCallback((): void => {
    forceHydrateFromQueryRef.current = true;
    void stateQuery.refetch();
  }, [stateQuery]);

  const beginMutationReplaySync = useCallback((state: DevServerGroupState | null): void => {
    const baselineByScriptId = new Map<string, number | null>();

    for (const script of state?.scripts ?? []) {
      baselineByScriptId.set(
        script.scriptId,
        getDevServerTerminalBuffer(terminalBuffersRef.current, script.scriptId)?.lastSequence ??
          null,
      );
    }

    pendingMutationReplaySyncRef.current = {
      baselineByScriptId,
      observedScriptIds: new Set(),
    };
  }, []);

  const syncTerminalBuffersFromMutationState = useCallback(
    (state: DevServerGroupState): void => {
      const pendingReplaySync = pendingMutationReplaySyncRef.current;
      if (!pendingReplaySync) {
        hydrateTerminalBuffersFromState(state);
        return;
      }

      const nextScriptIds = new Set(state.scripts.map((script) => script.scriptId));
      for (const scriptId of terminalBuffersRef.current.keys()) {
        if (!nextScriptIds.has(scriptId)) {
          terminalBuffersRef.current.delete(scriptId);
        }
      }

      for (const script of state.scripts) {
        const currentBuffer = getDevServerTerminalBuffer(
          terminalBuffersRef.current,
          script.scriptId,
        );
        const currentLastSequence = currentBuffer?.lastSequence ?? null;
        const baselineLastSequence =
          pendingReplaySync.baselineByScriptId.get(script.scriptId) ?? null;
        const nextLastSequence = getLatestBufferedTerminalSequence(script);
        const shouldReplaceReplay =
          !pendingReplaySync.observedScriptIds.has(script.scriptId) ||
          currentLastSequence === baselineLastSequence ||
          (nextLastSequence !== null &&
            (currentLastSequence === null || nextLastSequence > currentLastSequence));

        if (shouldReplaceReplay) {
          replaceDevServerTerminalBuffer(
            terminalBuffersRef.current,
            script.scriptId,
            script.bufferedTerminalChunks,
          );
        }
      }

      pendingMutationReplaySyncRef.current = null;
    },
    [hydrateTerminalBuffersFromState],
  );

  const syncStateFromEvent = useCallback(
    (event: DevServerEvent): void => {
      if (!repoPath || !taskId) {
        return;
      }

      const pendingReplaySync = pendingMutationReplaySyncRef.current;
      if (pendingReplaySync) {
        if (event.type === "snapshot") {
          for (const script of event.state.scripts) {
            pendingReplaySync.observedScriptIds.add(script.scriptId);
          }
        } else if (event.type === "script_status_changed") {
          pendingReplaySync.observedScriptIds.add(event.script.scriptId);
        } else {
          pendingReplaySync.observedScriptIds.add(event.terminalChunk.scriptId);
        }
      }

      if (event.type === "snapshot") {
        syncDevServerTerminalBufferStore(terminalBuffersRef.current, event.state);
      } else if (event.type === "script_status_changed") {
        replaceDevServerTerminalBuffer(
          terminalBuffersRef.current,
          event.script.scriptId,
          event.script.bufferedTerminalChunks,
        );
      } else {
        appendDevServerTerminalChunk(terminalBuffersRef.current, event.terminalChunk);
      }

      if (event.type !== "terminal_chunk") {
        const queryKey = devServerQueryKeys.state(repoPath, taskId);
        const cachedState = queryClient.getQueryData<DevServerGroupState>(queryKey) ?? null;
        setLiveState((current) => {
          const scopedCurrent =
            current && current.repoPath === repoPath && current.taskId === taskId ? current : null;
          const nextState = applyDevServerEventToState(cachedState ?? scopedCurrent, event);
          if (nextState) {
            queryClient.setQueryData(queryKey, nextState);
          }
          return nextState;
        });
      }

      const selectedId = selectedScriptIdRef.current;
      const touchedScriptId =
        event.type === "snapshot"
          ? selectedId
          : event.type === "script_status_changed"
            ? event.script.scriptId
            : event.terminalChunk.scriptId;
      if (selectedId && touchedScriptId === selectedId) {
        syncSelectedScriptTerminalBuffer(selectedId);
      }
    },
    [queryClient, repoPath, syncSelectedScriptTerminalBuffer, taskId],
  );

  useEffect(() => {
    const scopeChanged = previousTaskMemoryKeyRef.current !== taskMemoryKey;
    previousTaskMemoryKeyRef.current = taskMemoryKey;

    if (scopeChanged) {
      terminalBuffersRef.current.clear();
      forceHydrateFromQueryRef.current = false;
      pendingMutationReplaySyncRef.current = null;
      setLiveState(null);
      setSelectedScriptId(null);
      setSelectedScriptTerminalBuffer(null);
      setActionError(null);
      setSubscriptionError(null);
    }

    if (!queryEnabled) {
      terminalBuffersRef.current.clear();
      forceHydrateFromQueryRef.current = false;
      pendingMutationReplaySyncRef.current = null;
      setLiveState(null);
      setActionError(null);
      setSubscriptionError(null);
      setSelectedScriptId(null);
      setSelectedScriptTerminalBuffer(null);
      return;
    }

    if (
      queryActivationState.enabled === queryEnabled &&
      stateQuery.data &&
      stateQuery.dataUpdatedAt >= queryActivationState.since
    ) {
      hydrateTerminalBuffersFromState(stateQuery.data, forceHydrateFromQueryRef.current);
      forceHydrateFromQueryRef.current = false;
      setLiveState(stateQuery.data);
      syncSelectedScriptTerminalBuffer(selectedScriptIdRef.current);
    }
  }, [
    hydrateTerminalBuffersFromState,
    queryActivationState.enabled,
    queryActivationState.since,
    queryEnabled,
    syncSelectedScriptTerminalBuffer,
    stateQuery.data,
    stateQuery.dataUpdatedAt,
    taskMemoryKey,
  ]);

  const syncQueryState = useCallback(
    (nextState: DevServerGroupState): void => {
      if (!repoPath || !taskId) {
        return;
      }

      syncTerminalBuffersFromMutationState(nextState);
      queryClient.setQueryData(devServerQueryKeys.state(repoPath, taskId), nextState);
      setLiveState(nextState);
      syncSelectedScriptTerminalBuffer(selectedScriptIdRef.current);
    },
    [
      queryClient,
      repoPath,
      syncTerminalBuffersFromMutationState,
      syncSelectedScriptTerminalBuffer,
      taskId,
    ],
  );

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
      setActionError(null);
      beginMutationReplaySync(effectiveState);
    },
    onSuccess: syncQueryState,
    onError: (error: unknown) => {
      pendingMutationReplaySyncRef.current = null;
      setActionError(errorMessage(error));
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
      setActionError(null);
      beginMutationReplaySync(effectiveState);
    },
    onSuccess: syncQueryState,
    onError: (error: unknown) => {
      pendingMutationReplaySyncRef.current = null;
      setActionError(errorMessage(error));
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
      setActionError(null);
      beginMutationReplaySync(effectiveState);
    },
    onSuccess: syncQueryState,
    onError: (error: unknown) => {
      pendingMutationReplaySyncRef.current = null;
      setActionError(errorMessage(error));
    },
    onSettled: (_data, error) => {
      if (error) {
        invalidateState();
      }
    },
  });

  const hasFreshQueryData =
    stateQuery.data !== undefined && stateQuery.dataUpdatedAt >= queryActivationState.since;
  const shouldUseQueryData =
    queryEnabled && hasFreshQueryData && queryActivationState.enabled === queryEnabled;
  const currentLiveState = queryEnabled ? liveState : null;
  const effectiveState =
    currentLiveState ?? (shouldUseQueryData ? (stateQuery.data ?? null) : null);
  const shouldSubscribeToEvents =
    queryEnabled &&
    (startMutation.isPending ||
      stopMutation.isPending ||
      restartMutation.isPending ||
      (effectiveState?.scripts.some((script) => script.status !== "stopped") ?? false));
  const isAwaitingFreshState =
    queryEnabled &&
    effectiveState == null &&
    !stateQuery.error &&
    (stateQuery.isPending || stateQuery.isFetching || stateQuery.data !== undefined);
  const rememberedScriptId = taskMemoryKey
    ? (selectionMemoryRef.current.get(taskMemoryKey) ?? null)
    : null;
  const effectiveSelectedScriptId = useMemo(
    () =>
      selectDefaultDevServerTab(
        effectiveState?.scripts ?? [],
        selectedScriptId ?? rememberedScriptId,
      ),
    [effectiveState?.scripts, rememberedScriptId, selectedScriptId],
  );

  useLayoutEffect(() => {
    selectedScriptIdRef.current = effectiveSelectedScriptId;
    syncSelectedScriptTerminalBuffer(effectiveSelectedScriptId);
  }, [effectiveSelectedScriptId, syncSelectedScriptTerminalBuffer]);

  useEffect(() => {
    if (!shouldSubscribeToEvents || repoPath === null || taskId === null) {
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
        setSubscriptionError(
          `Received invalid dev server event payload: ${errorMessage(parsed.error)}`,
        );
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
      setActionError(null);
      setSubscriptionError(null);
    })
      .then((cleanup) => {
        if (cancelled) {
          cleanup();
          return;
        }

        unsubscribe = cleanup;
        setSubscriptionError(null);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSubscriptionError(errorMessage(error));
        }
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [repoPath, requestTerminalRehydrate, shouldSubscribeToEvents, syncStateFromEvent, taskId]);

  useEffect(() => {
    if (!taskMemoryKey) {
      return;
    }

    if (effectiveSelectedScriptId) {
      selectionMemoryRef.current.set(taskMemoryKey, effectiveSelectedScriptId);
      if (selectedScriptId !== effectiveSelectedScriptId) {
        setSelectedScriptId(effectiveSelectedScriptId);
      }
      return;
    }

    selectionMemoryRef.current.delete(taskMemoryKey);
    if (selectedScriptId !== null) {
      setSelectedScriptId(null);
    }
  }, [effectiveSelectedScriptId, selectedScriptId, taskMemoryKey]);

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

  const onSelectScript = useCallback(
    (scriptId: string): void => {
      if (!taskMemoryKey) {
        return;
      }

      selectionMemoryRef.current.set(taskMemoryKey, scriptId);
      setSelectedScriptId(scriptId);
    },
    [taskMemoryKey],
  );

  const error =
    actionError ?? subscriptionError ?? (stateQuery.error ? errorMessage(stateQuery.error) : null);

  return {
    mode,
    isExpanded,
    isLoading: isAwaitingFreshState || stateQuery.isLoading,
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
