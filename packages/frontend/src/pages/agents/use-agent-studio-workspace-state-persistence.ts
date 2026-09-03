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
  const activeWorkspaceIdRef = useRef(workspaceId);
  activeWorkspaceIdRef.current = workspaceId;
  const baselineRef = useRef<{ workspaceId: string | null; key: string | null }>({
    workspaceId: null,
    key: null,
  });
  const lastRequestedKeyRef = useRef<string | null>(null);
  const latestRequestRef = useRef<PersistRequest | null>(null);
  const [persistenceError, setPersistenceError] = useState<Error | null>(null);
  const { mutate } = useMutation({
    mutationFn: (request: PersistRequest) =>
      hostClient.workspaceReplaceAgentStudioState(request.workspaceId, request.state),
    scope: { id: `agent-studio-workspace-state:${workspaceId ?? "inactive"}` },
    onSuccess: (repoConfig, request) => {
      queryClient.setQueryData<RepoConfig>(
        workspaceQueryKeys.repoConfig(request.workspaceId),
        repoConfig,
      );
      if (activeWorkspaceIdRef.current !== request.workspaceId) {
        return;
      }
      baselineRef.current = { workspaceId: request.workspaceId, key: request.key };
      setPersistenceError(null);
    },
    onError: (cause, request) => {
      if (activeWorkspaceIdRef.current !== request.workspaceId) {
        return;
      }
      setPersistenceError(cause instanceof Error ? cause : new Error(String(cause)));
    },
  });

  useEffect(() => {
    baselineRef.current = { workspaceId, key: null };
    lastRequestedKeyRef.current = null;
    latestRequestRef.current = null;
    setPersistenceError(null);
  }, [workspaceId]);

  useEffect(() => {
    if (
      !workspaceId ||
      !loadedState ||
      baselineRef.current.workspaceId !== workspaceId ||
      baselineRef.current.key !== null ||
      lastRequestedKeyRef.current !== null
    ) {
      return;
    }
    baselineRef.current = { workspaceId, key: stateKey(loadedState) };
  }, [loadedState, workspaceId]);

  useEffect(() => {
    if (!enabled || !workspaceId || !loadedState) {
      return;
    }
    const key = stateKey(state);
    const request = { workspaceId, state, key };
    latestRequestRef.current = request;
    if (
      baselineRef.current.workspaceId === workspaceId &&
      (baselineRef.current.key === key || lastRequestedKeyRef.current === key)
    ) {
      return;
    }

    lastRequestedKeyRef.current = key;
    mutate(request);
  }, [enabled, loadedState, mutate, state, workspaceId]);

  const retryPersistence = useCallback((): void => {
    const request = latestRequestRef.current;
    if (!request) {
      return;
    }
    setPersistenceError(null);
    mutate(request);
  }, [mutate]);

  return { persistenceError, retryPersistence };
}
