import { type AzureDevOpsRepository, type SettingsRepoConfig } from "@openducktor/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { host } from "@/state/operations/shared/host";
import {
  type AzureRemoteMappingDraft,
  type AzureRepositoryDraft,
  azureDevOpsConnectionConfigurationFingerprint,
  azureDevOpsHttpConsentCollectionUrl,
  azureDevOpsRepositoryKey,
  azureRemoteMappingDraftErrors,
  azureRepositoryDraftErrors,
  buildAzureRemoteMappingDrafts,
  buildAzureRepositoryDraft,
  isAzureDevOpsRepository,
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
  if (!enabled) return 0;
  const parsed = parseAzureRepositoryDraft(draft);
  const repository = parsed.success ? parsed.data : undefined;
  return [
    ...Object.values(azureRepositoryDraftErrors(draft)),
    ...mappings.flatMap((mapping) =>
      Object.values(azureRemoteMappingDraftErrors(mapping, repository)),
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
    buildAzureRemoteMappingDrafts(configuredProvider?.remoteMappings),
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
    () =>
      remoteMappingDrafts.map((mapping) =>
        azureRemoteMappingDraftErrors(mapping, parsedRepository),
      ),
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
    configuredProvider?.httpConsentCollectionUrl === httpCollectionUrl;
  const connectionInput: AzureDevOpsConnectionInput | null = parsedRepository
    ? { repoPath: selectedRepoPath, repository: parsedRepository }
    : null;
  if (connectionInput && consentGranted && httpCollectionUrl) {
    connectionInput.httpConsentCollectionUrl = httpCollectionUrl;
  }
  const { actionError: connectionActionError, ...connectionController } =
    useAzureDevOpsConnectionController({
      workspaceId: selectedRepoConfig.workspaceId,
      selectedRepoPath,
      providerState,
      providerEnabled,
      configurationFingerprint,
      connectionInput,
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
          remoteMappings,
          httpConsentCollectionUrl:
            repository?.deployment === "server" &&
            repository.serviceUrl.startsWith("http://") &&
            repoConfig.git.provider?.httpConsentCollectionUrl ===
              azureDevOpsHttpConsentCollectionUrl(repository)
              ? repoConfig.git.provider.httpConsentCollectionUrl
              : undefined,
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
        setDraft(buildAzureRepositoryDraft(repository));
        if (repositoryChanged) setRemoteMappingDrafts(nextMappings);
        onValidationChange(
          azureDevOpsValidationErrorCount(
            buildAzureRepositoryDraft(repository),
            nextMappings,
            providerEnabled,
          ),
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
                    remoteMappings: repositoryChanged
                      ? undefined
                      : repoConfig.git.provider.remoteMappings,
                    httpConsentCollectionUrl: repositoryChanged
                      ? undefined
                      : repoConfig.git.provider.httpConsentCollectionUrl,
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
            httpConsentCollectionUrl: checked ? (httpCollectionUrl ?? undefined) : undefined,
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
