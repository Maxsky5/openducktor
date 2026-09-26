import { type AzureDevOpsRepository, type SettingsRepoConfig } from "@openducktor/contracts";
import {
  azureDevOpsConnectionConfigurationFingerprint,
  azureDevOpsRepositoryKey,
  isAzureDevOpsRepository,
} from "@openducktor/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@/lib/errors";
import { host } from "@/state/operations/shared/host";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import {
  type AzureRemoteMappingDraft,
  type AzureRepositoryDraft,
  azureDevOpsHttpConsentCollectionUrl,
  azureRemoteMappingDraftListErrors,
  azureRepositoryDraftErrors,
  buildAzureRemoteMappingDrafts,
  buildAzureRepositoryDraft,
  parseAzureRepositoryDraft,
  toAzureRemoteMappings,
} from "./azure-devops-git-provider-form-model";
import {
  type AzureDevOpsConnectionInput,
  useAzureDevOpsConnectionController,
} from "./use-azure-devops-connection-controller";
import type { GitProviderState } from "./use-repository-git-section-model";

type ConfiguredProvider = SettingsRepoConfig["git"]["provider"];

export type UseAzureDevOpsGitProviderFormInput = {
  selectedRepoPath: string;
  selectedRepoConfig: SettingsRepoConfig;
  providerState: GitProviderState;
  onUpdateSelectedRepoConfig: (
    updater: (current: SettingsRepoConfig) => SettingsRepoConfig,
  ) => void;
  onValidationChange: (errorCount: number) => void;
};

const azureDevOpsValidationErrorCount = (
  draft: AzureRepositoryDraft,
  mappings: AzureRemoteMappingDraft[],
  enabled: boolean,
): number => {
  const parsed = parseAzureRepositoryDraft(draft);
  const repository = parsed.success ? parsed.data : undefined;
  return [
    ...(enabled ? Object.values(azureRepositoryDraftErrors(draft)) : []),
    ...azureRemoteMappingDraftListErrors(mappings, repository).flatMap((errors) =>
      Object.values(errors),
    ),
  ].filter(Boolean).length;
};

export const useAzureDevOpsGitProviderForm = ({
  selectedRepoPath,
  selectedRepoConfig,
  providerState,
  onUpdateSelectedRepoConfig,
  onValidationChange,
}: UseAzureDevOpsGitProviderFormInput) => {
  const configuredProvider = selectedRepoConfig.git.provider;
  const configuredRepository = configuredAzureRepository(configuredProvider);
  const configuredRepositoryRef = useRef(configuredRepository);
  const [draft, setDraft] = useState<AzureRepositoryDraft>(() =>
    buildAzureRepositoryDraft(configuredRepository),
  );
  const [remoteMappingDrafts, setRemoteMappingDrafts] = useState<AzureRemoteMappingDraft[]>(() =>
    buildAzureRemoteMappingDrafts(configuredProvider?.settings?.remoteMappings),
  );
  const [repositoryActionError, setRepositoryActionError] = useState<string | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const providerEnabled = configuredProvider?.enabled === true;

  const parsedRepository = useMemo(() => {
    const result = parseAzureRepositoryDraft(draft);
    return result.success ? result.data : undefined;
  }, [draft]);
  const repositoryErrors = useMemo(() => azureRepositoryDraftErrors(draft), [draft]);
  const mappingErrors = useMemo(
    () => azureRemoteMappingDraftListErrors(remoteMappingDrafts, parsedRepository),
    [parsedRepository, remoteMappingDrafts],
  );
  const configurationFingerprint = parsedRepository
    ? azureDevOpsConnectionConfigurationFingerprint(
        selectedRepoConfig.workspaceId,
        selectedRepoPath,
        parsedRepository,
      )
    : null;
  const httpCollectionUrl = azureDevOpsHttpConsentCollectionUrl(parsedRepository);
  const consentGranted =
    httpCollectionUrl !== null &&
    configuredProvider?.settings?.httpConsentCollectionUrl === httpCollectionUrl;
  const connectionInput: AzureDevOpsConnectionInput | null = parsedRepository
    ? { repoPath: selectedRepoPath, repository: parsedRepository }
    : null;
  const { actionError: connectionActionError, ...connectionController } =
    useAzureDevOpsConnectionController({
      workspaceId: selectedRepoConfig.workspaceId,
      selectedRepoPath,
      providerState,
      providerEnabled,
      configurationFingerprint,
      connectionInput,
    });
  const hasConnectedAccount =
    connectionController.canManageConnection &&
    connectionController.connectionState.status === "connected";
  const areaController = useAzureDevOpsAreaPaths({
    selectedRepoConfig,
    selectedRepoPath,
    parsedRepository,
    configurationFingerprint,
    providerEnabled,
    canManageConnection: connectionController.canManageConnection,
    hasConnectedAccount,
    onUpdateSelectedRepoConfig,
  });

  useEffect(() => {
    configuredRepositoryRef.current = configuredRepository;
  }, [configuredRepository]);

  const writeDraftToSettings = (
    nextDraft: AzureRepositoryDraft,
    nextMappings: AzureRemoteMappingDraft[],
  ): void => {
    const parsed = parseAzureRepositoryDraft(nextDraft);
    if (!parsed.success) return;
    const repository = parsed.data;
    const remoteMappings = toAzureRemoteMappings(nextMappings, repository);
    const consentCollectionUrl =
      repository.deployment === "server" && repository.serviceUrl.startsWith("http://")
        ? azureDevOpsHttpConsentCollectionUrl(repository)
        : null;
    onUpdateSelectedRepoConfig((repoConfig) => ({
      ...repoConfig,
      git: {
        ...repoConfig.git,
        provider: {
          ...repoConfig.git.provider,
          id: "azure_devops",
          enabled: repoConfig.git.provider?.enabled ?? true,
          autoDetected: false,
          repository,
          settings: {
            areaPath: sameAzureProject(
              configuredAzureRepository(repoConfig.git.provider),
              repository,
            )
              ? repoConfig.git.provider?.settings?.areaPath
              : undefined,
            remoteMappings,
            httpConsentCollectionUrl:
              repoConfig.git.provider?.settings?.httpConsentCollectionUrl === consentCollectionUrl
                ? repoConfig.git.provider.settings.httpConsentCollectionUrl
                : undefined,
          },
        },
      },
    }));
  };

  const updateDraft = (next: AzureRepositoryDraft): void => {
    setDraft(next);
    onValidationChange(azureDevOpsValidationErrorCount(next, remoteMappingDrafts, providerEnabled));
    writeDraftToSettings(next, remoteMappingDrafts);
  };

  const updateRemoteMappings = (next: AzureRemoteMappingDraft[]): void => {
    setRemoteMappingDrafts(next);
    onValidationChange(azureDevOpsValidationErrorCount(draft, next, providerEnabled));
    writeDraftToSettings(draft, next);
  };

  const resolvedContext =
    providerState.status === "loaded" && providerState.context?.config.id === "azure_devops"
      ? providerState.context
      : null;
  const isReady = resolvedContext?.health.available === true;
  const readinessMessage =
    providerState.status === "error"
      ? providerState.message
      : (resolvedContext?.health.reason ?? defaultReadinessMessage(providerEnabled));

  return {
    actionError: connectionActionError,
    ...connectionController,
    configurationFingerprint,
    connectionInput,
    consentGranted,
    draft,
    httpCollectionUrl,
    isDetecting,
    mappingErrors,
    providerEnabled,
    isReady,
    readinessMessage,
    remoteMappingDrafts,
    ...areaController,
    repositoryActionError,
    repositoryErrors,
    setProviderEnabled(enabled: boolean) {
      onValidationChange(azureDevOpsValidationErrorCount(draft, remoteMappingDrafts, enabled));
      onUpdateSelectedRepoConfig((repoConfig) => ({
        ...repoConfig,
        git: {
          ...repoConfig.git,
          provider: {
            ...repoConfig.git.provider,
            id: "azure_devops",
            enabled,
            autoDetected: repoConfig.git.provider?.autoDetected ?? false,
          },
        },
      }));
    },
    async detectRepository(): Promise<boolean> {
      setIsDetecting(true);
      setRepositoryActionError(null);
      try {
        const repository = await host.workspaceDetectAzureDevOpsRepository(selectedRepoPath);
        if (!repository || !isAzureDevOpsRepository(repository)) return false;
        const currentRepository = configuredRepositoryRef.current;
        const repositoryChanged =
          !currentRepository ||
          azureDevOpsRepositoryKey(currentRepository) !== azureDevOpsRepositoryKey(repository);
        const nextMappings = repositoryChanged ? [] : remoteMappingDrafts;
        const repositoryDraft = buildAzureRepositoryDraft(repository);
        setDraft(repositoryDraft);
        if (repositoryChanged) setRemoteMappingDrafts(nextMappings);
        onValidationChange(
          azureDevOpsValidationErrorCount(repositoryDraft, nextMappings, providerEnabled),
        );
        onUpdateSelectedRepoConfig((repoConfig) =>
          repoConfig.repoPath !== selectedRepoPath || repoConfig.git.provider?.id !== "azure_devops"
            ? repoConfig
            : {
                ...repoConfig,
                git: {
                  ...repoConfig.git,
                  provider: {
                    ...repoConfig.git.provider,
                    autoDetected: true,
                    repository,
                    settings: {
                      areaPath: sameAzureProject(
                        configuredAzureRepository(repoConfig.git.provider),
                        repository,
                      )
                        ? repoConfig.git.provider.settings?.areaPath
                        : undefined,
                      remoteMappings: repositoryChanged
                        ? undefined
                        : repoConfig.git.provider.settings?.remoteMappings,
                      httpConsentCollectionUrl: repositoryChanged
                        ? undefined
                        : repoConfig.git.provider.settings?.httpConsentCollectionUrl,
                    },
                  },
                },
              },
        );
        return true;
      } catch (cause) {
        setRepositoryActionError(errorMessage(cause));
        return false;
      } finally {
        setIsDetecting(false);
      }
    },
    updateDraft,
    updateRemoteMappings,
    setHttpConsent(checked: boolean) {
      onUpdateSelectedRepoConfig((repoConfig) => ({
        ...repoConfig,
        git: {
          ...repoConfig.git,
          provider: {
            ...repoConfig.git.provider,
            id: "azure_devops",
            enabled: repoConfig.git.provider?.enabled ?? true,
            autoDetected: repoConfig.git.provider?.autoDetected ?? false,
            settings: {
              ...repoConfig.git.provider?.settings,
              httpConsentCollectionUrl: checked ? (httpCollectionUrl ?? undefined) : undefined,
            },
          },
        },
      }));
    },
  };
};

const useAzureDevOpsAreaPaths = ({
  selectedRepoConfig,
  selectedRepoPath,
  parsedRepository,
  configurationFingerprint,
  providerEnabled,
  canManageConnection,
  hasConnectedAccount,
  onUpdateSelectedRepoConfig,
}: Pick<
  UseAzureDevOpsGitProviderFormInput,
  "selectedRepoConfig" | "selectedRepoPath" | "onUpdateSelectedRepoConfig"
> & {
  parsedRepository: AzureDevOpsRepository | undefined;
  configurationFingerprint: string | null;
  providerEnabled: boolean;
  canManageConnection: boolean;
  hasConnectedAccount: boolean;
}) => {
  const selectedAreaPath = selectedRepoConfig.git.provider?.settings?.areaPath ?? "";
  const savedAreaPath =
    useQuery(settingsSnapshotQueryOptions()).data?.workspaces[selectedRepoConfig.workspaceId]?.git
      .provider?.settings?.areaPath ?? "";
  const canLoadAreaPaths = canManageConnection && providerEnabled && hasConnectedAccount;
  const areasQuery = useQuery({
    queryKey: ["azure-devops", "area-paths", selectedRepoPath, configurationFingerprint],
    enabled: canLoadAreaPaths && parsedRepository !== undefined,
    queryFn: async () => {
      if (!parsedRepository)
        throw new Error("Set an Azure DevOps project before loading its areas.");
      const saved = await host.workspaceGetRepoConfig(selectedRepoConfig.workspaceId);
      const savedRepository = configuredAzureRepository(saved.git.provider);
      if (!savedRepository || !sameAzureProject(savedRepository, parsedRepository)) {
        throw new Error("Save the Azure DevOps project settings, then load its area paths.");
      }
      return host.azureAreaPathsList(selectedRepoPath);
    },
  });

  return {
    areaPaths: areasQuery.data ?? [],
    areaPathsError: areasQuery.isError ? errorMessage(areasQuery.error) : null,
    canLoadAreaPaths,
    hasConnectedAccount,
    isAreaPathDirty: selectedAreaPath !== savedAreaPath,
    isLoadingAreaPaths: areasQuery.isFetching,
    selectedAreaPath,
    reloadAreaPaths: () => void areasQuery.refetch(),
    setAreaPath(areaPath: string) {
      onUpdateSelectedRepoConfig((repoConfig) => ({
        ...repoConfig,
        git: {
          ...repoConfig.git,
          provider: {
            ...repoConfig.git.provider,
            id: "azure_devops",
            enabled: repoConfig.git.provider?.enabled ?? true,
            autoDetected: repoConfig.git.provider?.autoDetected ?? false,
            settings: {
              ...repoConfig.git.provider?.settings,
              areaPath: areaPath || undefined,
            },
          },
        },
      }));
    },
  };
};

const configuredAzureRepository = (
  provider: ConfiguredProvider,
): AzureDevOpsRepository | undefined => {
  const repository = provider?.repository;
  return repository && isAzureDevOpsRepository(repository) ? repository : undefined;
};

const defaultReadinessMessage = (providerEnabled: boolean): string =>
  providerEnabled
    ? "Save the repository identity, then connect Azure DevOps."
    : "Enable Azure DevOps to use pull requests and review checks.";

export type AzureDevOpsGitProviderFormController = ReturnType<typeof useAzureDevOpsGitProviderForm>;

const sameAzureProject = (
  left: AzureDevOpsRepository | undefined,
  right: AzureDevOpsRepository | undefined,
): boolean =>
  Boolean(
    left &&
    right &&
    left.deployment === right.deployment &&
    left.serviceUrl === right.serviceUrl &&
    left.organization === right.organization &&
    left.project === right.project,
  );
