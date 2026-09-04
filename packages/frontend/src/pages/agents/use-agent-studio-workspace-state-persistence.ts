import type { RepoConfig, WorkspaceAgentStudioState } from "@openducktor/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { host } from "@/state/operations/host";
import { workspaceQueryKeys } from "@/state/queries/workspace";

type AgentStudioStateHost = Pick<typeof host, "workspaceReplaceAgentStudioState">;

type PersistRequest = {
  workspaceId: string;
  state: WorkspaceAgentStudioState;
  key: string;
};

type PersistFailure = {
  request: PersistRequest;
  error: Error;
};

const stateKey = (state: WorkspaceAgentStudioState): string => JSON.stringify(state);

export function useAgentStudioWorkspaceStatePersistence({
  workspaceId,
  loadedState,
  state,
  enabled,
  hostClient = host,
}: {
  workspaceId: string | null;
  loadedState: WorkspaceAgentStudioState | null;
  state: WorkspaceAgentStudioState;
  enabled: boolean;
  hostClient?: AgentStudioStateHost;
}) {
  const queryClient = useQueryClient();
  const lastRequestedRef = useRef<{ workspaceId: string; key: string } | null>(null);
  const [failure, setFailure] = useState<PersistFailure | null>(null);
  const { mutate } = useMutation({
    mutationFn: (request: PersistRequest) =>
      hostClient.workspaceReplaceAgentStudioState(request.workspaceId, request.state),
    scope: { id: `agent-studio-workspace-state:${workspaceId ?? "inactive"}` },
    onSuccess: (repoConfig, request) => {
      queryClient.setQueryData<RepoConfig>(
        workspaceQueryKeys.repoConfig(request.workspaceId),
        repoConfig,
      );
      setFailure((current) => (current?.request === request ? null : current));
    },
    onError: (cause, request) => {
      setFailure({
        request,
        error: cause instanceof Error ? cause : new Error(String(cause)),
      });
    },
  });
  const loadedKey = loadedState ? stateKey(loadedState) : null;
  const desiredKey = stateKey(state);
  const failedRequestIsCurrent = Boolean(
    failure &&
    failure.request.workspaceId === workspaceId &&
    failure.request.key === desiredKey &&
    loadedKey !== desiredKey,
  );
  const persistenceError = failedRequestIsCurrent ? (failure?.error ?? null) : null;

  useEffect(() => {
    if (!enabled || !workspaceId || !loadedState) {
      return;
    }
    if (loadedKey === desiredKey) {
      return;
    }
    const lastRequested = lastRequestedRef.current;
    if (lastRequested?.workspaceId === workspaceId && lastRequested.key === desiredKey) {
      return;
    }

    const request = { workspaceId, state, key: desiredKey };
    lastRequestedRef.current = { workspaceId, key: desiredKey };
    mutate(request);
  }, [desiredKey, enabled, loadedKey, loadedState, mutate, state, workspaceId]);

  const retryPersistence = useCallback((): void => {
    if (!failedRequestIsCurrent || !failure) {
      return;
    }
    setFailure(null);
    lastRequestedRef.current = {
      workspaceId: failure.request.workspaceId,
      key: failure.request.key,
    };
    mutate(failure.request);
  }, [failedRequestIsCurrent, failure, mutate]);

  return { persistenceError, retryPersistence };
}
