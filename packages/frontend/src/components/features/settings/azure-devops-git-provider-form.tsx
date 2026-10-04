import type { SettingsRepoConfig } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { AzureDevOpsAreaSettings } from "./azure-devops-area-settings";
import { AzureDevOpsConnectionSettings } from "./azure-devops-connection-settings";
import { AzureDevOpsRepositorySettings } from "./azure-devops-repository-settings";
import { AzureDevOpsProviderCard } from "./azure-devops-provider-card";
import { azureProviderReadiness } from "./azure-devops-provider-readiness";
import {
  useAzureDevOpsGitProviderForm,
  type UseAzureDevOpsGitProviderFormInput,
} from "./use-azure-devops-git-provider-form";
import type { GitProviderState } from "./use-repository-git-section-model";

type AzureDevOpsGitProviderFormProps = {
  selectedRepoPath: string;
  selectedRepoConfig: SettingsRepoConfig;
  providerState: GitProviderState;
  disabled: boolean;
  onSaveSettings: () => Promise<boolean>;
  onValidationChange: UseAzureDevOpsGitProviderFormInput["onValidationChange"];
  onUpdateSelectedRepoConfig: UseAzureDevOpsGitProviderFormInput["onUpdateSelectedRepoConfig"];
};

export function AzureDevOpsGitProviderForm({
  disabled,
  onSaveSettings,
  selectedRepoConfig,
  selectedRepoPath,
  ...input
}: AzureDevOpsGitProviderFormProps): ReactElement {
  const controller = useAzureDevOpsGitProviderForm({
    ...input,
    selectedRepoConfig,
    selectedRepoPath,
  });
  const repositoryReady = controller.connectionInput !== null;
  let readiness = azureProviderReadiness({
    enabled: controller.providerEnabled,
    hasRepository: repositoryReady,
    hasAccount: controller.hasConnectedAccount,
    ready: controller.isReady,
  });
  if (controller.providerEnabled && repositoryReady && controller.hasConnectedAccount) {
    if (!controller.selectedAreaPath) readiness = { label: "Choose area", variant: "warning" };
    else if (controller.isAreaPathDirty) readiness = { label: "Save area", variant: "warning" };
  }
  return (
    <AzureDevOpsProviderCard
      enabled={controller.providerEnabled}
      disabled={disabled}
      onEnabledChange={controller.setProviderEnabled}
      readiness={readiness}
      description="Link the repository, connect your account, and choose an area for work item imports."
    >
      <AzureDevOpsRepositorySettings
        controller={controller}
        disabled={disabled}
        repoPath={selectedRepoPath}
        workspaceName={selectedRepoConfig.workspaceName}
      />
      {repositoryReady ? (
        <AzureDevOpsConnectionSettings
          controller={controller}
          disabled={disabled}
          onSaveSettings={onSaveSettings}
        />
      ) : null}
      <AzureDevOpsAreaSettings controller={controller} disabled={disabled} />
    </AzureDevOpsProviderCard>
  );
}
