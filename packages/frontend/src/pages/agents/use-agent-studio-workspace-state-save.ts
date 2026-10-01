import type {
  WorkspaceAgentStudioState,
  WorkspaceAgentStudioStateAction,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { host } from "@/state/operations/host";
import { applyWorkspaceAgentStudioStateAction } from "./agent-studio-state-writer";

type AgentStudioStateHost = Pick<typeof host, "workspaceApplyAgentStudioStateAction">;

type SaveRequest = {
  workspaceId: string;
  key: string;
  action: WorkspaceAgentStudioStateAction;
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
  const lastSaveRef = useRef<{
    workspaceId: string;
    key: string;
    actionType: WorkspaceAgentStudioStateAction["type"];
  } | null>(null);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const loadedKey = loadedState ? toStateKey(loadedState) : null;
  const nextKey = toStateKey(state);
  const save = useCallback(
    (request: SaveRequest): void => {
      void applyWorkspaceAgentStudioStateAction({
        queryClient,
        workspaceId: request.workspaceId,
        action: request.action,
        hostClient,
      }).then(
        () => setFailure((current) => (current?.request === request ? null : current)),
        (cause: unknown) =>
          setFailure({
            request,
            error: cause instanceof Error ? cause : new Error(String(cause)),
          }),
      );
    },
    [hostClient, queryClient],
  );
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
    const lastSave = lastSaveRef.current;
    if (
      lastSave?.workspaceId === workspaceId &&
      lastSave.key === nextKey &&
      lastSave.actionType === "sync_snapshot"
    ) {
      return;
    }
    if (loadedKey === nextKey && lastSave?.workspaceId !== workspaceId) {
      return;
    }

    const action: WorkspaceAgentStudioStateAction = {
      type: "sync_snapshot",
      baseOpenTaskIds: loadedState.openTaskIds,
      openTaskIds: state.openTaskIds,
      activeTask: state.activeTask ?? null,
    };

    const request = { workspaceId, key: nextKey, action };
    lastSaveRef.current = { workspaceId, key: nextKey, actionType: action.type };
    save(request);
  }, [enabled, loadedKey, loadedState, nextKey, save, state, workspaceId]);

  const retrySave = useCallback((): void => {
    if (!saveFailedForCurrentState || !failure) {
      return;
    }
    setFailure(null);
    lastSaveRef.current = {
      workspaceId: failure.request.workspaceId,
      key: failure.request.key,
      actionType: failure.request.action.type,
    };
    save(failure.request);
  }, [failure, save, saveFailedForCurrentState]);

  return { saveError, retrySave };
}
