import type {
  WorkspaceAgentStudioState,
  WorkspaceAgentStudioStateAction,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { host } from "@/state/operations/host";
import { applyWorkspaceAgentStudioStateAction } from "./agent-studio-state-writer";

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
  const lastSaveRef = useRef<SaveRequest | null>(null);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const loadedKey = loadedState ? JSON.stringify(loadedState) : null;
  const stateKey = JSON.stringify(state);
  const save = useCallback(
    (request: SaveRequest): Promise<void> => {
      return applyWorkspaceAgentStudioStateAction({
        queryClient,
        workspaceId: request.workspaceId,
        action: request.action,
        hostClient,
      }).then(
        () => setFailure((current) => (current?.request === request ? null : current)),
        (cause: unknown) => {
          const lastSave = lastSaveRef.current;
          // A late failure must not replace the error for a newer save.
          if (lastSave?.workspaceId !== request.workspaceId || lastSave.key !== request.key) {
            return;
          }
          setFailure({
            request,
            error: cause instanceof Error ? cause : new Error(String(cause)),
          });
        },
      );
    },
    [hostClient, queryClient],
  );
  const currentFailure =
    failure &&
    failure.request.workspaceId === workspaceId &&
    failure.request.key === stateKey &&
    loadedKey !== stateKey
      ? failure
      : null;

  useEffect(() => {
    if (!enabled || !workspaceId || !loadedState) {
      return;
    }
    const lastSave = lastSaveRef.current;
    if (lastSave?.workspaceId === workspaceId && lastSave.key === stateKey) {
      return;
    }
    if (loadedKey === stateKey && lastSave?.workspaceId !== workspaceId) {
      return;
    }

    const action: WorkspaceAgentStudioStateAction = {
      type: "sync_snapshot",
      baseOpenTaskIds: loadedState.openTaskIds,
      openTaskIds: state.openTaskIds,
      activeTask: state.activeTask ?? null,
    };

    const request = { workspaceId, key: stateKey, action };
    lastSaveRef.current = request;
    void save(request);
  }, [enabled, loadedKey, loadedState, save, state, stateKey, workspaceId]);

  const retrySave = useCallback((): Promise<void> => {
    if (!currentFailure) {
      return Promise.resolve();
    }
    lastSaveRef.current = currentFailure.request;
    return save(currentFailure.request);
  }, [currentFailure, save]);

  return { saveError: currentFailure?.error ?? null, retrySave };
}

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
