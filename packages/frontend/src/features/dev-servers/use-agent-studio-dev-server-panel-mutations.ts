import type { DevServerGroupState } from "@openducktor/contracts";
import { type QueryClient, useMutation } from "@tanstack/react-query";
import { type Dispatch, type RefObject, useCallback } from "react";
import { errorMessage } from "@/lib/errors";
import { hostClient } from "@/lib/host-client";
import { devServerQueryKeys } from "@/state/queries/dev-servers";
import {
  type DevServerScope,
  isSameDevServerScope,
  MISSING_DEV_SERVER_SCOPE_MESSAGE,
} from "@/types/dev-server-scope";
import type { DevServerPanelAction } from "./use-agent-studio-dev-server-panel-state";

type DevServerMutationCommand = (scope: DevServerScope) => Promise<DevServerGroupState>;

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
  dispatchLocalState,
  invalidateState,
  isActiveMutationScope,
  syncMutationSuccessState,
  transportEpochRef,
}: {
  dispatchLocalState: Dispatch<DevServerPanelAction>;
  invalidateState: (scope: DevServerScope, epoch: string) => void;
  isActiveMutationScope: (scope: DevServerScope) => boolean;
  syncMutationSuccessState: (state: DevServerGroupState, epoch: string) => void;
  transportEpochRef: RefObject<string | null>;
}) =>
  useCallback(
    (mutationFn: DevServerMutationCommand) => ({
      mutationFn,
      onMutate: (scope: DevServerScope) => {
        if (isActiveMutationScope(scope)) {
          dispatchLocalState({ type: "actionStarted" });
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
      dispatchLocalState,
      invalidateState,
      isActiveMutationScope,
      syncMutationSuccessState,
      transportEpochRef,
    ],
  );

type DevServerMutationHooksInput = {
  activeScope: DevServerScope | null;
  dispatchLocalState: Dispatch<DevServerPanelAction>;
  queryClient: QueryClient;
  transportEpochRef: RefObject<string | null>;
};

export const useDevServerMutations = ({
  activeScope,
  dispatchLocalState,
  queryClient,
  transportEpochRef,
}: DevServerMutationHooksInput) => {
  const isActiveMutationScope = useCallback(
    (scope: DevServerScope | null | undefined): boolean => {
      return isSameDevServerScope(scope ?? null, activeScope);
    },
    [activeScope],
  );

  const syncMutationSuccessState = useCallback(
    (nextState: DevServerGroupState, mutationTransportEpoch: string): void => {
      queryClient.setQueryData<DevServerGroupState>(
        devServerQueryKeys.state(nextState.repoPath, nextState.owner, mutationTransportEpoch),
        (current) => (current && current.revision > nextState.revision ? current : nextState),
      );
    },
    [queryClient],
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
    dispatchLocalState,
    invalidateState,
    isActiveMutationScope,
    syncMutationSuccessState,
    transportEpochRef,
  });

  const startMutation = useMutation<
    DevServerGroupState,
    unknown,
    DevServerScope,
    DevServerMutationContext
  >(
    createScopedMutationOptions(async (scope): Promise<DevServerGroupState> =>
      hostClient.devServerStart(scope.repoPath, scope.owner),
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
