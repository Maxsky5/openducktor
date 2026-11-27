import type {
  WorkspaceAgentStudioState,
  WorkspaceAgentStudioStateAction,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHostConnectionState } from "@openducktor/frontend-core/connection/use-host-connection-state";
import { isConnectionFailure } from "@openducktor/frontend-core/lib/command-outcome";
import { applyWorkspaceAgentStudioStateAction } from "./agent-studio-state-writer";

export function useAgentStudioWorkspaceStateSave({
  workspaceId,
  loadedState,
  state,
  enabled,
}: {
  workspaceId: string | null;
  loadedState: WorkspaceAgentStudioState | null;
  state: WorkspaceAgentStudioState;
  enabled: boolean;
}) {
  const queryClient = useQueryClient();
  // A save waits for the host connection, so a lost connection does not replace the page.
  const connected = useHostConnectionState() === "connected";
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
      }).then(
        () => setFailure((current) => (current?.request === request ? null : current)),
        (cause: unknown) => {
          // A late failure must not replace the error for a newer save.
          if (lastSaveRef.current !== request) {
            return;
          }
          // The connection indicator explains a lost host. The save runs again after the reconnect.
          if (isConnectionFailure(cause)) {
            lastSaveRef.current = null;
            return;
          }
          setFailure({
            request,
            error: cause instanceof Error ? cause : new Error(String(cause)),
          });
        },
      );
    },
    [queryClient],
  );
  const currentFailure =
    failure &&
    failure.request.workspaceId === workspaceId &&
    failure.request.key === stateKey &&
    loadedKey !== stateKey
      ? failure
      : null;

  useEffect(() => {
    if (!enabled || !connected || !workspaceId || !loadedState) {
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
    setFailure(null);
    void save(request);
  }, [connected, enabled, loadedKey, loadedState, save, state, stateKey, workspaceId]);

  const retrySave = useCallback((): Promise<void> => {
    if (!currentFailure) {
      return Promise.resolve();
    }
    lastSaveRef.current = currentFailure.request;
    return save(currentFailure.request);
  }, [currentFailure, save]);

  return { saveError: currentFailure?.error ?? null, retrySave };
}

type SaveRequest = {
  workspaceId: string;
  key: string;
  action: WorkspaceAgentStudioStateAction;
};

type SaveFailure = {
  request: SaveRequest;
  error: Error;
};
