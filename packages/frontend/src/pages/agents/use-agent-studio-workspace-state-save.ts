import type { RepoConfig, WorkspaceAgentStudioState } from "@openducktor/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { host } from "@/state/operations/host";
import { workspaceQueryKeys } from "@/state/queries/workspace";

type AgentStudioStateHost = Pick<typeof host, "workspaceReplaceAgentStudioState">;

type SaveRequest = {
  workspaceId: string;
  state: WorkspaceAgentStudioState;
  key: string;
};

type SaveFailure = {
  request: SaveRequest;
  error: Error;
};

const toStateKey = (state: WorkspaceAgentStudioState): string => JSON.stringify(state);

export function useAgentStudioWorkspaceStateSave({
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
  const lastSaveRef = useRef<{ workspaceId: string; key: string } | null>(null);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const { mutate } = useMutation({
    mutationFn: (request: SaveRequest) =>
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
  const loadedKey = loadedState ? toStateKey(loadedState) : null;
  const nextKey = toStateKey(state);
  const saveFailedForCurrentState = Boolean(
    failure &&
    failure.request.workspaceId === workspaceId &&
    failure.request.key === nextKey &&
    loadedKey !== nextKey,
  );
  const saveError = saveFailedForCurrentState ? (failure?.error ?? null) : null;

  useEffect(() => {
    if (!enabled || !workspaceId || !loadedState) {
      return;
    }
    if (loadedKey === nextKey) {
      return;
    }
    const lastSave = lastSaveRef.current;
    if (lastSave?.workspaceId === workspaceId && lastSave.key === nextKey) {
      return;
    }

    const request = { workspaceId, state, key: nextKey };
    lastSaveRef.current = { workspaceId, key: nextKey };
    mutate(request);
  }, [enabled, loadedKey, loadedState, mutate, nextKey, state, workspaceId]);

  const retrySave = useCallback((): void => {
    if (!saveFailedForCurrentState || !failure) {
      return;
    }
    setFailure(null);
    lastSaveRef.current = {
      workspaceId: failure.request.workspaceId,
      key: failure.request.key,
    };
    mutate(failure.request);
  }, [failure, mutate, saveFailedForCurrentState]);

  return { saveError, retrySave };
}
