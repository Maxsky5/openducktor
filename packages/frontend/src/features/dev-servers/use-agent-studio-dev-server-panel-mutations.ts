import type { DevServerGroupState, DevServerOwner } from "@openducktor/contracts";
import { type QueryClient, useMutation } from "@tanstack/react-query";
import { type Dispatch, type RefObject, useCallback } from "react";
import { errorMessage } from "@/lib/errors";
import { hostClient } from "@/lib/host-client";
import { devServerQueryKeys } from "@/state/queries/dev-servers";
import {
  type DevServerScope,
  isSameDevServerOwner,
  isSameDevServerScope,
  MISSING_DEV_SERVER_SCOPE_MESSAGE,
} from "@/types/dev-server-scope";
import type {
  DevServerPanelAction,
  TerminalBuffers,
} from "./use-agent-studio-dev-server-panel-state";

type DevServerMutationCommand = (scope: DevServerScope) => Promise<DevServerGroupState>;

type DevServerMutationOptions = {
  restoreCachedStateOnError?: boolean;
};

type DevServerMutationContext = {
  transportEpoch: string | null;
};

export const devServerAction =
  (
    scope: DevServerScope | null,
    dispatch: Dispatch<DevServerPanelAction>,
    mutate: (scope: DevServerScope) => void,
  ): (() => void) =>
  () => {
    if (!scope) {
      dispatch({ type: "actionFailed", error: MISSING_DEV_SERVER_SCOPE_MESSAGE });
      return;
    }
    mutate(scope);
  };

const useScopedDevServerMutationOptions = ({
  beginMutationReplaySync,
  cancelMutationReplaySync,
  dispatchLocalState,
  effectiveState,
  invalidateState,
  isActiveMutationScope,
  restoreCachedState,
  syncMutationSuccessState,
  transportEpochRef,
}: {
  beginMutationReplaySync: (state: DevServerGroupState | null) => void;
  cancelMutationReplaySync: () => void;
  dispatchLocalState: Dispatch<DevServerPanelAction>;
  effectiveState: DevServerGroupState | null;
  invalidateState: (scope: DevServerScope, epoch: string) => void;
  isActiveMutationScope: (scope: DevServerScope) => boolean;
  restoreCachedState: (epoch: string) => void;
  syncMutationSuccessState: (state: DevServerGroupState, epoch: string) => void;
  transportEpochRef: RefObject<string | null>;
}) =>
  useCallback(
    (mutationFn: DevServerMutationCommand, options: DevServerMutationOptions = {}) => ({
      mutationFn,
      onMutate: (scope: DevServerScope) => {
        if (isActiveMutationScope(scope)) {
          dispatchLocalState({ type: "actionStarted" });
          beginMutationReplaySync(effectiveState);
        }
        return {
          transportEpoch: transportEpochRef.current,
        } satisfies DevServerMutationContext;
      },
      onSuccess: (
        data: DevServerGroupState,
        _scope: DevServerScope,
        context: DevServerMutationContext | undefined,
      ) => {
        if (!context?.transportEpoch || context.transportEpoch !== transportEpochRef.current) {
          return;
        }
        syncMutationSuccessState(data, context.transportEpoch);
      },
      onError: (
        cause: unknown,
        scope: DevServerScope,
        context: DevServerMutationContext | undefined,
      ) => {
        if (!context?.transportEpoch || context.transportEpoch !== transportEpochRef.current) {
          return;
        }
        if (isActiveMutationScope(scope)) {
          cancelMutationReplaySync();
          if (options.restoreCachedStateOnError) {
            restoreCachedState(context.transportEpoch);
          }
          dispatchLocalState({ type: "actionFailed", error: errorMessage(cause) });
        }
      },
      onSettled: (
        _data: DevServerGroupState | undefined,
        cause: unknown,
        scope: DevServerScope,
        context: DevServerMutationContext | undefined,
      ) => {
        if (
          cause &&
          context?.transportEpoch &&
          context.transportEpoch === transportEpochRef.current
        ) {
          invalidateState(scope, context.transportEpoch);
        }
      },
    }),
    [
      beginMutationReplaySync,
      cancelMutationReplaySync,
      dispatchLocalState,
      effectiveState,
      invalidateState,
      isActiveMutationScope,
      restoreCachedState,
      syncMutationSuccessState,
      transportEpochRef,
    ],
  );

type DevServerMutationHooksInput = {
  activeScope: DevServerScope | null;
  beginMutationReplaySync: TerminalBuffers["beginMutationReplaySync"];
  cancelMutationReplaySync: TerminalBuffers["cancelMutationReplaySync"];
  dispatchLocalState: Dispatch<DevServerPanelAction>;
  effectiveState: DevServerGroupState | null;
  owner: DevServerOwner | null;
  queryClient: QueryClient;
  repoPath: string | null;
  replaceTerminalBuffersFromState: TerminalBuffers["replaceTerminalBuffersFromState"];
  selectedScriptIdRef: { current: string | null };
  syncTerminalBuffersFromMutationState: TerminalBuffers["syncTerminalBuffersFromMutationState"];
  transportEpochRef: RefObject<string | null>;
};

export const useDevServerMutations = ({
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
}: DevServerMutationHooksInput) => {
  const syncQueryState = useCallback(
    (nextState: DevServerGroupState): boolean => {
      if (effectiveState && nextState.revision < effectiveState.revision) return false;
      if (!syncTerminalBuffersFromMutationState(nextState, selectedScriptIdRef.current)) {
        return false;
      }
      dispatchLocalState({ type: "liveStateChanged", state: nextState });
      return true;
    },
    [dispatchLocalState, effectiveState, selectedScriptIdRef, syncTerminalBuffersFromMutationState],
  );

  const isActiveMutationScope = useCallback(
    (scope: DevServerScope | null | undefined): boolean => {
      return isSameDevServerScope(scope ?? null, activeScope);
    },
    [activeScope],
  );

  const syncMutationSuccessState = useCallback(
    (nextState: DevServerGroupState, mutationTransportEpoch: string): void => {
      const isActiveState =
        nextState.repoPath === repoPath &&
        owner !== null &&
        isSameDevServerOwner(nextState.owner, owner);
      if (isActiveState && !syncQueryState(nextState)) {
        return;
      }
      queryClient.setQueryData<DevServerGroupState>(
        devServerQueryKeys.state(nextState.repoPath, nextState.owner, mutationTransportEpoch),
        (current) => (current && current.revision > nextState.revision ? current : nextState),
      );
    },
    [queryClient, repoPath, syncQueryState, owner],
  );

  const restoreCachedState = useCallback(
    (mutationTransportEpoch: string): void => {
      if (!repoPath || !owner) {
        return;
      }

      const cachedState =
        queryClient.getQueryData<DevServerGroupState>(
          devServerQueryKeys.state(repoPath, owner, mutationTransportEpoch),
        ) ?? null;
      if (replaceTerminalBuffersFromState(cachedState, selectedScriptIdRef.current)) {
        dispatchLocalState({ type: "liveStateChanged", state: cachedState });
      }
    },
    [
      dispatchLocalState,
      queryClient,
      repoPath,
      replaceTerminalBuffersFromState,
      selectedScriptIdRef,
      owner,
    ],
  );

  const invalidateState = useCallback(
    (scope: DevServerScope, mutationTransportEpoch: string): void => {
      void queryClient.invalidateQueries({
        queryKey: devServerQueryKeys.state(scope.repoPath, scope.owner, mutationTransportEpoch),
        exact: true,
        refetchType: "active",
      });
    },
    [queryClient],
  );

  const createScopedMutationOptions = useScopedDevServerMutationOptions({
    beginMutationReplaySync,
    cancelMutationReplaySync,
    dispatchLocalState,
    effectiveState,
    invalidateState,
    isActiveMutationScope,
    restoreCachedState,
    syncMutationSuccessState,
    transportEpochRef,
  });

  const startMutation = useMutation<
    DevServerGroupState,
    unknown,
    DevServerScope,
    DevServerMutationContext
  >(
    createScopedMutationOptions(
      async (scope): Promise<DevServerGroupState> =>
        hostClient.devServerStart(scope.repoPath, scope.owner),
      { restoreCachedStateOnError: true },
    ),
  );

  const stopMutation = useMutation<
    DevServerGroupState,
    unknown,
    DevServerScope,
    DevServerMutationContext
  >(
    createScopedMutationOptions(async (scope): Promise<DevServerGroupState> =>
      hostClient.devServerStop(scope.repoPath, scope.owner),
    ),
  );

  const restartMutation = useMutation<
    DevServerGroupState,
    unknown,
    DevServerScope,
    DevServerMutationContext
  >(
    createScopedMutationOptions(async (scope): Promise<DevServerGroupState> =>
      hostClient.devServerRestart(scope.repoPath, scope.owner),
    ),
  );

  return { startMutation, stopMutation, restartMutation, isActiveMutationScope };
};
