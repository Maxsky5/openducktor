import type { AzureDevOpsConnectionState, AzureDevOpsRepository } from "@openducktor/contracts";
import {
  azureDevOpsConnectionConfigurationFingerprint,
  isAzureDevOpsRepository,
} from "@openducktor/core";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { subscribeAzureDevOpsConnectionUpdates } from "@/lib/host-client";
import { host } from "@/state/operations/shared/host";
import { repositoryGitProviderContextQueryKeys } from "@/state/queries/git-provider-context";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import {
  azureDevOpsHttpConsentCollectionUrl,
  isAzureDevOpsConnectionEventCurrent,
} from "./azure-devops-git-provider-form-model";
import type { GitProviderState } from "./use-repository-git-section-model";

export type AzureDevOpsConnectionInput = {
  repoPath: string;
  repository: AzureDevOpsRepository;
};

type UseAzureDevOpsConnectionControllerInput = {
  workspaceId: string;
  selectedRepoPath: string;
  providerState: GitProviderState;
  providerEnabled: boolean;
  configurationFingerprint: string | null;
  connectionInput: AzureDevOpsConnectionInput | null;
};

const disconnectedConnectionState: AzureDevOpsConnectionState = {
  status: "disconnected",
};

const connectionKey = (configurationFingerprint: string | null) => [
  "azure-devops-connection",
  configurationFingerprint ?? "missing",
];

const useAzureDevOpsConnectionUpdates = ({
  activeAttemptIdRef,
  configurationFingerprint,
  invalidateProviderContext,
  queryClient,
  selectedRepoPath,
  setActionError,
  workspaceId,
}: {
  activeAttemptIdRef: RefObject<string | null>;
  configurationFingerprint: string | null;
  invalidateProviderContext: () => Promise<void>;
  queryClient: QueryClient;
  selectedRepoPath: string;
  setActionError: (message: string | null) => void;
  workspaceId: string;
}): boolean => {
  const [updatesReady, setUpdatesReady] = useState(false);
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    setUpdatesReady(false);
    void subscribeAzureDevOpsConnectionUpdates((event) => {
      if (
        isAzureDevOpsConnectionEventCurrent(event, {
          workspaceId,
          repoPath: selectedRepoPath,
          configurationFingerprint,
          attemptId: activeAttemptIdRef.current,
        })
      ) {
        queryClient.setQueryData(connectionKey(configurationFingerprint), event.state);
        if (event.state.status !== "pending") {
          activeAttemptIdRef.current = null;
          void invalidateProviderContext();
        }
      }
    })
      .then((stop) => {
        if (!active) {
          stop();
          return;
        }
        unsubscribe = stop;
        setUpdatesReady(true);
        void queryClient.invalidateQueries({
          queryKey: connectionKey(configurationFingerprint),
          exact: true,
        });
      })
      .catch((cause: unknown) => {
        if (active) {
          setActionError(`Azure DevOps connection updates are unavailable: ${errorMessage(cause)}`);
        }
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [
    activeAttemptIdRef,
    configurationFingerprint,
    invalidateProviderContext,
    queryClient,
    selectedRepoPath,
    setActionError,
    workspaceId,
  ]);
  return updatesReady;
};

type ConnectionActionDependencies = {
  activeAttemptIdRef: RefObject<string | null>;
  canManageConnection: boolean;
  configurationFingerprint: string | null;
  connectionInput: AzureDevOpsConnectionInput | null;
  connectionState: AzureDevOpsConnectionState;
  httpConsentSaved: boolean;
  pat: string;
  runMutation: <Result>(
    operation: () => Promise<Result>,
    onResult?: (result: Result) => void,
  ) => void;
  setConnectionState: (state: AzureDevOpsConnectionState) => void;
  setPat: (pat: string) => void;
  updatesReady: boolean;
};

const createConnectionActions = ({
  activeAttemptIdRef,
  canManageConnection,
  configurationFingerprint,
  connectionInput,
  connectionState,
  httpConsentSaved,
  pat,
  runMutation,
  setConnectionState,
  setPat,
  updatesReady,
}: ConnectionActionDependencies) => ({
  disconnect() {
    if (!canManageConnection || !connectionInput) return;
    runMutation(
      () => host.workspaceDisconnectAzureDevOps(connectionInput),
      () => {
        activeAttemptIdRef.current = null;
      },
    );
  },
  startSignIn() {
    if (!canManageConnection || !connectionInput || !updatesReady) return;
    runMutation(
      () => host.workspaceStartAzureDevOpsSignIn(connectionInput),
      (deviceCode) => {
        if (configurationFingerprint) activeAttemptIdRef.current = deviceCode.attemptId;
      },
    );
  },
  cancelSignIn() {
    if (!canManageConnection || connectionState.status !== "pending") return;
    runMutation(
      () => host.workspaceCancelAzureDevOpsSignIn(connectionState.deviceCode.attemptId),
      () => {
        activeAttemptIdRef.current = null;
      },
    );
  },
  savePat() {
    if (!canManageConnection || !connectionInput || !httpConsentSaved) return;
    runMutation(
      () => host.workspaceReplaceAzureDevOpsPat({ ...connectionInput, pat }),
      (state) => {
        setConnectionState(state);
        setPat("");
      },
    );
  },
});

export const useAzureDevOpsConnectionController = ({
  workspaceId,
  selectedRepoPath,
  providerState,
  providerEnabled,
  configurationFingerprint,
  connectionInput,
}: UseAzureDevOpsConnectionControllerInput) => {
  const queryClient = useQueryClient();
  const [pat, setPat] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [isMutatingConnection, setIsMutatingConnection] = useState(false);
  const activeAttemptIdRef = useRef<string | null>(null);
  const savedProvider = useQuery(settingsSnapshotQueryOptions()).data?.workspaces[workspaceId]?.git
    .provider;
  const loadedProvider =
    providerState.status === "loaded" ? providerState.context?.config : undefined;
  const persistedProvider = savedProvider ?? loadedProvider;
  const persistedRepository = persistedProvider?.repository;
  const canManageConnection = Boolean(
    providerEnabled &&
    persistedProvider?.id === "azure_devops" &&
    persistedProvider.enabled &&
    persistedRepository &&
    isAzureDevOpsRepository(persistedRepository) &&
    azureDevOpsConnectionConfigurationFingerprint(
      workspaceId,
      selectedRepoPath,
      persistedRepository,
    ) === configurationFingerprint,
  );
  const httpCollectionUrl = connectionInput
    ? azureDevOpsHttpConsentCollectionUrl(connectionInput.repository)
    : null;
  const httpConsentSaved =
    httpCollectionUrl === null ||
    persistedProvider?.settings?.httpConsentCollectionUrl === httpCollectionUrl;
  const connectionQuery = useQuery({
    queryKey: connectionKey(configurationFingerprint),
    enabled: canManageConnection && connectionInput !== null,
    queryFn: () => host.workspaceGetAzureDevOpsConnection(connectionInput!),
    retry: false,
    staleTime: 30_000,
  });
  const connectionReadFailed = connectionQuery.isError;
  const connectionState: AzureDevOpsConnectionState = connectionReadFailed
    ? { status: "error", reason: errorMessage(connectionQuery.error) }
    : (connectionQuery.data ?? disconnectedConnectionState);
  const invalidateProviderContext = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: repositoryGitProviderContextQueryKeys.repo(selectedRepoPath),
        exact: true,
      }),
    [queryClient, selectedRepoPath],
  );

  const pendingAttemptId =
    connectionState.status === "pending" ? connectionState.deviceCode.attemptId : null;
  useEffect(() => {
    if (pendingAttemptId) activeAttemptIdRef.current = pendingAttemptId;
  }, [pendingAttemptId]);

  const updatesReady = useAzureDevOpsConnectionUpdates({
    activeAttemptIdRef,
    configurationFingerprint,
    invalidateProviderContext,
    queryClient,
    selectedRepoPath,
    setActionError,
    workspaceId,
  });

  const runMutation = <Result>(
    operation: () => Promise<Result>,
    onResult?: (result: Result) => void,
  ): void => {
    void (async () => {
      setIsMutatingConnection(true);
      setActionError(null);
      try {
        const result = await operation();
        onResult?.(result);
        await queryClient.invalidateQueries({
          queryKey: connectionKey(configurationFingerprint),
        });
        await invalidateProviderContext();
      } catch (error) {
        setActionError(errorMessage(error));
      } finally {
        setIsMutatingConnection(false);
      }
    })();
  };

  return {
    actionError,
    canManageConnection,
    connectionReadFailed,
    connectionState,
    httpConsentSaved,
    isMutatingConnection,
    pat,
    retryConnectionRead() {
      void connectionQuery.refetch();
    },
    setPat,
    ...createConnectionActions({
      activeAttemptIdRef,
      canManageConnection,
      configurationFingerprint,
      connectionInput,
      connectionState,
      httpConsentSaved,
      pat,
      runMutation,
      setConnectionState: (state) =>
        queryClient.setQueryData(connectionKey(configurationFingerprint), state),
      setPat,
      updatesReady,
    }),
    updatesReady,
  };
};
