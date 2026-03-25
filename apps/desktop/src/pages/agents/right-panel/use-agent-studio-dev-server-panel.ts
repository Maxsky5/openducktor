import type {
  DevServerEvent,
  DevServerGroupState,
  DevServerScriptState,
} from "@openducktor/contracts";
import { devServerEventSchema } from "@openducktor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DevServerLogBufferStore } from "@/features/agent-studio-build-tools/dev-server-log-buffer";
import {
  appendDevServerLogLine,
  createDevServerLogBufferStore,
  getDevServerLogBuffer,
  replaceDevServerLogBuffer,
  syncDevServerLogBufferStore,
  trimDevServerLogLines,
} from "@/features/agent-studio-build-tools/dev-server-log-buffer";
import type {
  AgentStudioDevServerPanelMode,
  AgentStudioDevServerPanelModel,
} from "@/components/features/agents/agent-studio-dev-server-panel";
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

const buildTaskMemoryKey = (repoPath: string, taskId: string): string => `${repoPath}::${taskId}`;

const replaceScript = (
  scripts: DevServerScriptState[],
  nextScript: DevServerScriptState,
): DevServerScriptState[] =>
  scripts.map((script) => (script.scriptId === nextScript.scriptId ? nextScript : script));

export const applyDevServerEventToState = (
  state: DevServerGroupState | null,
  event: DevServerEvent,
): DevServerGroupState | null => {
  if (event.type === "snapshot") {
    return {
      ...event.state,
      scripts: event.state.scripts.map((script) => ({
        ...script,
        bufferedLogLines: trimDevServerLogLines(script.bufferedLogLines),
      })),
    };
  }

  if (!state || state.repoPath !== event.repoPath || state.taskId !== event.taskId) {
    return state;
  }

  if (event.type === "script_status_changed") {
    return {
      ...state,
      updatedAt: event.updatedAt,
      scripts: replaceScript(state.scripts, {
        ...event.script,
        bufferedLogLines: trimDevServerLogLines(event.script.bufferedLogLines),
      }),
    };
  }

  return {
    ...state,
    updatedAt: event.logLine.timestamp,
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
  const logBuffersRef = useRef<DevServerLogBufferStore>(createDevServerLogBufferStore());
  const previousTaskMemoryKeyRef = useRef<string | null | undefined>(undefined);
  const selectedScriptIdRef = useRef<string | null>(null);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [liveState, setLiveState] = useState<DevServerGroupState | null>(null);
  const [selectedScriptLogRevision, setSelectedScriptLogRevision] = useState(0);
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

  const syncStateFromEvent = useCallback(
    (event: DevServerEvent): void => {
      if (!repoPath || !taskId) {
        return;
      }

      if (event.type === "snapshot") {
        syncDevServerLogBufferStore(logBuffersRef.current, event.state);
      } else if (event.type === "script_status_changed") {
        replaceDevServerLogBuffer(
          logBuffersRef.current,
          event.script.scriptId,
          event.script.bufferedLogLines,
        );
      } else {
        appendDevServerLogLine(logBuffersRef.current, event.logLine);
      }

      if (event.type !== "log_line") {
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
            : event.logLine.scriptId;
      if (selectedId && touchedScriptId === selectedId) {
        setSelectedScriptLogRevision((revision) => revision + 1);
      }
    },
    [queryClient, repoPath, taskId],
  );

  useEffect(() => {
    const scopeChanged = previousTaskMemoryKeyRef.current !== taskMemoryKey;
    previousTaskMemoryKeyRef.current = taskMemoryKey;

    if (scopeChanged) {
      logBuffersRef.current.clear();
      setLiveState(null);
      setSelectedScriptId(null);
      setSelectedScriptLogRevision(0);
      setActionError(null);
      setSubscriptionError(null);
    }

    if (!queryEnabled) {
      logBuffersRef.current.clear();
      setLiveState(null);
      setActionError(null);
      setSubscriptionError(null);
      setSelectedScriptId(null);
      setSelectedScriptLogRevision(0);
      return;
    }

    if (
      queryActivationState.enabled === queryEnabled &&
      stateQuery.data &&
      stateQuery.dataUpdatedAt >= queryActivationState.since
    ) {
      syncDevServerLogBufferStore(logBuffersRef.current, stateQuery.data);
      setLiveState(stateQuery.data);
      setSelectedScriptLogRevision((revision) => revision + 1);
    }
  }, [
    queryActivationState.enabled,
    queryActivationState.since,
    queryEnabled,
    stateQuery.data,
    stateQuery.dataUpdatedAt,
    taskMemoryKey,
  ]);

  const syncQueryState = useCallback(
    (nextState: DevServerGroupState): void => {
      if (!repoPath || !taskId) {
        return;
      }

      syncDevServerLogBufferStore(logBuffersRef.current, nextState);
      queryClient.setQueryData(devServerQueryKeys.state(repoPath, taskId), nextState);
      setLiveState(nextState);
      setSelectedScriptLogRevision((revision) => revision + 1);
    },
    [queryClient, repoPath, taskId],
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
    },
    onSuccess: syncQueryState,
    onError: (error: unknown) => {
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
    },
    onSuccess: syncQueryState,
    onError: (error: unknown) => {
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
    },
    onSuccess: syncQueryState,
    onError: (error: unknown) => {
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

  useEffect(() => {
    selectedScriptIdRef.current = effectiveSelectedScriptId;
  }, [effectiveSelectedScriptId]);

  useEffect(() => {
    if (!shouldSubscribeToEvents || repoPath === null || taskId === null) {
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void subscribeDevServerEvents((payload) => {
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
  }, [repoPath, shouldSubscribeToEvents, syncStateFromEvent, taskId]);

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
  const selectedScriptLogBuffer = useMemo(
    () => getDevServerLogBuffer(logBuffersRef.current, effectiveSelectedScriptId),
    [effectiveSelectedScriptId, selectedScriptLogRevision],
  );
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
    selectedScriptLogBuffer,
    error,
    isStartPending: startMutation.isPending,
    isStopPending: stopMutation.isPending,
    isRestartPending: restartMutation.isPending,
    onSelectScript,
    onStart: () => {
      void startMutation.mutateAsync();
    },
    onStop: () => {
      void stopMutation.mutateAsync();
    },
    onRestart: () => {
      void restartMutation.mutateAsync();
    },
  };
}
