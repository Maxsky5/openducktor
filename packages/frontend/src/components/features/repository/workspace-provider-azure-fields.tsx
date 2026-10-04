import type { ComponentProps, ReactElement } from "react";
import { AzureDevOpsProviderCard } from "../settings/azure-devops-provider-card";
import { azureProviderReadiness } from "../settings/azure-devops-provider-readiness";
import { AzureDevOpsSetupArea } from "../settings/azure-devops-area-settings";
import { AzureDevOpsConnectionSettings } from "../settings/azure-devops-connection-settings";
import { AzureDevOpsRepositorySettings } from "../settings/azure-devops-repository-settings";
import {
  azureRepositoryDraftErrors,
  azureRemoteMappingDraftListErrors,
  parseAzureRepositoryDraft,
  azureDevOpsHttpConsentCollectionUrl,
} from "../settings/azure-devops-git-provider-form-model";
import type { FieldProps } from "./workspace-provider-fields";

export function AzureSetupFields({ provider, disabled }: FieldProps): ReactElement {
  const { draft } = provider;
  const parsed = parseAzureRepositoryDraft(draft.azure);
  const collectionUrl = parsed.success ? azureDevOpsHttpConsentCollectionUrl(parsed.data) : null;
  const repoPath = provider.session?.repoPath ?? "";
  const connectionInput = parsed.success ? { repoPath, repository: parsed.data } : null;
  const connected = provider.connection.status === "connected";
  const controller: ComponentProps<typeof AzureDevOpsRepositorySettings>["controller"] &
    ComponentProps<typeof AzureDevOpsConnectionSettings>["controller"] &
    ComponentProps<typeof AzureDevOpsSetupArea>["controller"] = {
    draft: draft.azure,
    updateDraft: (azure) => provider.update((current) => ({ ...current, azure })),
    detectRepository: async () => {
      await provider.retryDetection();
      return false;
    },
    isDetecting: provider.detecting,
    repositoryActionError: null,
    connectionInput,
    remoteMappingDrafts: draft.mappings,
    updateRemoteMappings: (mappings) => provider.update((current) => ({ ...current, mappings })),
    mappingErrors: azureRemoteMappingDraftListErrors(
      draft.mappings,
      parsed.success ? parsed.data : undefined,
    ),
    repositoryErrors: azureRepositoryDraftErrors(draft.azure),
    httpCollectionUrl: collectionUrl,
    consentGranted: collectionUrl !== null && draft.consent === collectionUrl,
    setHttpConsent: (granted) =>
      provider.update((current) => ({ ...current, consent: granted ? collectionUrl : null })),
    providerEnabled: draft.enabled,
    canManageConnection: connectionInput !== null,
    httpConsentSaved: !collectionUrl || draft.consent === collectionUrl,
    connectionState: provider.connection,
    connectionReadFailed: false,
    updatesReady: true,
    isMutatingConnection: provider.pending !== null,
    actionError: null,
    pat: provider.pat,
    setPat: provider.setPat,
    savePat: () => void provider.savePat(),
    startSignIn: () => void provider.startSignIn(),
    cancelSignIn: () => void provider.cancelSignIn(),
    disconnect: () => void provider.disconnect(),
    retryConnectionRead: () => void provider.check(),
    hasConnectedAccount: connected,
    areaPaths: provider.areas,
    areaPathsError: null,
    selectedAreaPath: draft.areaPath,
    canLoadAreaPaths: draft.enabled && connected && connectionInput !== null,
    isLoadingAreaPaths: provider.pending === "Load work item areas",
    reloadAreaPaths: () => void provider.loadAreas(),
    setAreaPath: (areaPath) => provider.update((current) => ({ ...current, areaPath })),
  };
  return (
    <AzureDevOpsProviderCard
      enabled={draft.enabled}
      disabled={disabled}
      onEnabledChange={(enabled) => provider.update((current) => ({ ...current, enabled }))}
      readiness={azureProviderReadiness({
        enabled: draft.enabled,
        hasRepository: connectionInput !== null,
        hasAccount: connected,
        ready: provider.status?.health?.available === true,
      })}
      description="Link the repository and connect your account. You can choose a work item area later."
    >
      <AzureDevOpsRepositorySettings
        controller={controller}
        disabled={disabled}
        repoPath={repoPath}
        workspaceName={draft.azure.name || "Selected repository"}
        defaultManualOpen={connectionInput === null}
        showErrors={provider.error !== null}
      />
      {connectionInput ? (
        <AzureDevOpsConnectionSettings
          controller={controller}
          disabled={disabled}
          onSaveSettings={async () => {
            await provider.ensureSelection();
            return true;
          }}
        />
      ) : null}
      <AzureDevOpsSetupArea controller={controller} disabled={disabled} />
    </AzureDevOpsProviderCard>
  );
}
