import type {
  DevServerEvent,
  DevServerGroupState,
  DevServerLogLine,
  DevServerScriptState,
} from "@openducktor/contracts";
import { devServerEventSchema } from "@openducktor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentStudioDevServerPanelMode,
  AgentStudioDevServerPanelModel,
} from "@/components/features/agents/agent-studio-dev-server-panel";
import { errorMessage } from "@/lib/errors";
import { hostClient, subscribeDevServerEvents } from "@/lib/host-client";
import { devServerGroupStateQueryOptions, devServerQueryKeys } from "@/state/queries/dev-servers";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";

const MAX_BUFFERED_LOG_LINES = 2_000;

type UseAgentStudioDevServerPanelArgs = {
  repoPath: string | null;
  taskId: string | null;
  repoSettings: RepoSettingsInput | null;
  activeSession: AgentSessionState | null;
  enabled: boolean;
};

type SelectedScriptMemory = Map<string, string>;

const buildTaskMemoryKey = (repoPath: string, taskId: string): string => `${repoPath}::${taskId}`;

export const trimDevServerLogLines = (lines: DevServerLogLine[]): DevServerLogLine[] => {
  if (lines.length <= MAX_BUFFERED_LOG_LINES) {
    return lines;
  }
  return lines.slice(-MAX_BUFFERED_LOG_LINES);
};

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
    scripts: state.scripts.map((script) => {
      if (script.scriptId !== event.logLine.scriptId) {
        return script;
      }

      return {
        ...script,
        bufferedLogLines: trimDevServerLogLines([...script.bufferedLogLines, event.logLine]),
      };
    }),
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
  activeSession,
  enabled,
}: UseAgentStudioDevServerPanelArgs): AgentStudioDevServerPanelModel {
  const queryClient = useQueryClient();
  const selectionMemoryRef = useRef<SelectedScriptMemory>(new Map());
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [liveState, setLiveState] = useState<DevServerGroupState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);

  const configuredScripts = repoSettings?.devServers ?? [];
  const hasConfiguredScripts = configuredScripts.length > 0;
  const queryEnabled = enabled && repoPath !== null && taskId !== null && hasConfiguredScripts;
  const queryActivationRef = useRef<{ enabled: boolean; since: number }>({
    enabled: queryEnabled,
    since: queryEnabled ? Date.now() : 0,
  });
  const taskMemoryKey = repoPath && taskId ? buildTaskMemoryKey(repoPath, taskId) : null;
  const activeSessionRefreshKey = `${activeSession?.sessionId ?? ""}:${activeSession?.status ?? ""}:${activeSession?.workingDirectory ?? ""}`;
  const queryOptions =
    repoPath && taskId
      ? devServerGroupStateQueryOptions(repoPath, taskId)
      : devServerGroupStateQueryOptions("__disabled__", "__disabled__");

  const stateQuery = useQuery({
    ...queryOptions,
    enabled: queryEnabled,
  });

  if (queryActivationRef.current.enabled !== queryEnabled) {
    queryActivationRef.current = {
      enabled: queryEnabled,
      since: queryEnabled ? Date.now() : 0,
    };
  }

  const syncStateFromEvent = useCallback(
    (event: DevServerEvent): void => {
      if (!repoPath || !taskId) {
        return;
      }

      const queryKey = devServerQueryKeys.state(repoPath, taskId);
      const cachedState = queryClient.getQueryData<DevServerGroupState>(queryKey) ?? null;
      setLiveState((current) => {
        const nextState = applyDevServerEventToState(current ?? cachedState, event);
        if (nextState) {
          queryClient.setQueryData(queryKey, nextState);
        }
        return nextState;
      });
    },
    [queryClient, repoPath, taskId],
  );

  useEffect(() => {
    if (!queryEnabled) {
      setLiveState(null);
      setActionError(null);
      setSubscriptionError(null);
      setSelectedScriptId(null);
      return;
    }

    if (stateQuery.data && stateQuery.dataUpdatedAt >= queryActivationRef.current.since) {
      setLiveState(stateQuery.data);
    }
  }, [queryEnabled, stateQuery.data, stateQuery.dataUpdatedAt]);

  useEffect(() => {
    if (!queryEnabled || repoPath === null || taskId === null) {
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void subscribeDevServerEvents((payload) => {
      const parsed = devServerEventSchema.safeParse(payload);
      if (!parsed.success) {
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
  }, [queryEnabled, repoPath, syncStateFromEvent, taskId]);

  useEffect(() => {
    if (!queryEnabled || repoPath === null || taskId === null) {
      return;
    }

    void activeSessionRefreshKey;

    void queryClient.invalidateQueries({
      queryKey: devServerQueryKeys.state(repoPath, taskId),
      exact: true,
      refetchType: "active",
    });
  }, [activeSessionRefreshKey, queryClient, queryEnabled, repoPath, taskId]);

  const syncQueryState = useCallback(
    (nextState: DevServerGroupState): void => {
      if (!repoPath || !taskId) {
        return;
      }

      queryClient.setQueryData(devServerQueryKeys.state(repoPath, taskId), nextState);
      setLiveState(nextState);
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
    onSettled: invalidateState,
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
    onSettled: invalidateState,
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
    onSettled: invalidateState,
  });

  const hasFreshQueryData =
    stateQuery.data !== undefined && stateQuery.dataUpdatedAt >= queryActivationRef.current.since;
  const effectiveState = liveState ?? (hasFreshQueryData ? (stateQuery.data ?? null) : null);
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

  const mode: AgentStudioDevServerPanelMode = useMemo(() => {
    if (!hasConfiguredScripts) {
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
  }, [effectiveState, hasConfiguredScripts, isAwaitingFreshState, isExpanded]);

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
