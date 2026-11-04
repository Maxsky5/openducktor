import {
  AZURE_DEVOPS_PROVIDER_DESCRIPTOR,
  GITLAB_PROVIDER_DESCRIPTOR,
  knownGitProviderIdSchema,
  type GitProviderConfig,
  type GitProviderRepository,
  type SettingsRepoConfig,
} from "@openducktor/contracts";
import type { ReactElement } from "react";
import {
  type GitProviderState,
  useRepositoryGitSectionModel,
} from "./use-repository-git-section-model";
import { AzureDevOpsGitProviderForm } from "./azure-devops-git-provider-form";
import { GithubGitProviderForm } from "./github-git-provider-form";
import { GitlabGitProviderForm } from "./gitlab-git-provider-form";
import { GitProviderSelector, type GitProviderSelection } from "./git-provider-selector";

type RepositoryGitSectionProps = {
  selectedRepoPath: string | null;
  selectedRepoConfig: SettingsRepoConfig | null;
  /** The saved provider of the repository. A switch back to it restores its saved settings. */
  savedGitProvider?: GitProviderConfig | null;
  providerState: GitProviderState;
  disabled: boolean;
  onDetectGithubRepository: () => Promise<GitProviderRepository | null>;
  onSaveSettings?: () => Promise<boolean>;
  onGitProviderValidationChange?: (errorCount: number) => void;
  onUpdateSelectedRepoConfig: (
    updater: (current: SettingsRepoConfig) => SettingsRepoConfig,
  ) => void;
};

const ignoreValidationChange = (): void => undefined;
const ignoreSaveSettings = async (): Promise<boolean> => false;

export function RepositoryGitSection({
  selectedRepoPath,
  selectedRepoConfig,
  savedGitProvider = null,
  providerState,
  disabled,
  onDetectGithubRepository,
  onSaveSettings = ignoreSaveSettings,
  onGitProviderValidationChange = ignoreValidationChange,
  onUpdateSelectedRepoConfig,
}: RepositoryGitSectionProps): ReactElement {
  const model = useRepositoryGitSectionModel({
    disabled,
    onDetectGithubRepository,
    onUpdateSelectedRepoConfig,
    providerState,
    selectedRepoConfig,
    selectedRepoPath,
  });

  if (!selectedRepoConfig) {
    return (
      <div className="rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning-surface-foreground">
        Select a repository to edit Git provider settings.
      </div>
    );
  }

  const selectedProviderId = selectedRepoConfig.git.provider?.id;
  const selectProvider = (providerId: Exclude<GitProviderSelection, "unsupported">): void => {
    const restoresSaved = savedGitProvider?.id === providerId;
    // Saved settings passed validation when they were saved.
    if (restoresSaved || (providerId !== "azure_devops" && providerId !== "gitlab")) {
      onGitProviderValidationChange(0);
    }
    onUpdateSelectedRepoConfig((repoConfig) => {
      if (providerId === "none") {
        if (!repoConfig.git.provider) return repoConfig;
        const { provider: _provider, ...git } = repoConfig.git;
        return { ...repoConfig, git };
      }
      if (repoConfig.git.provider?.id === providerId) return repoConfig;
      if (restoresSaved)
        return { ...repoConfig, git: { ...repoConfig.git, provider: savedGitProvider } };
      return {
        ...repoConfig,
        git: {
          ...repoConfig.git,
          provider: {
            id: providerId,
            enabled: true,
            autoDetected: false,
          },
        },
      };
    });
  };

  const providerSelection = (
    <GitProviderSelector
      disabled={disabled}
      selectedProviderId={selectableProvider(selectedProviderId)}
      onSelect={selectProvider}
    />
  );

  if (selectedProviderId === AZURE_DEVOPS_PROVIDER_DESCRIPTOR.id) {
    return (
      <div className="grid gap-4 p-4">
        {providerSelection}
        <AzureDevOpsGitProviderForm
          key={selectedRepoConfig.workspaceId}
          selectedRepoPath={selectedRepoPath ?? ""}
          selectedRepoConfig={selectedRepoConfig}
          providerState={providerState}
          disabled={disabled}
          onSaveSettings={onSaveSettings}
          onValidationChange={onGitProviderValidationChange}
          onUpdateSelectedRepoConfig={onUpdateSelectedRepoConfig}
        />
      </div>
    );
  }

  if (selectedProviderId === GITLAB_PROVIDER_DESCRIPTOR.id) {
    return (
      <div className="grid gap-4 p-4">
        {providerSelection}
        <GitlabGitProviderForm
          key={selectedRepoConfig.workspaceId}
          selectedRepoPath={selectedRepoPath ?? ""}
          selectedRepoConfig={selectedRepoConfig}
          providerState={providerState}
          disabled={disabled}
          onValidationChange={onGitProviderValidationChange}
          onUpdateSelectedRepoConfig={onUpdateSelectedRepoConfig}
        />
      </div>
    );
  }

  if (selectedProviderId === undefined) {
    return <div className="p-4">{providerSelection}</div>;
  }

  return (
    <div className="grid gap-4 p-4">
      {providerSelection}
      <GithubGitProviderForm disabled={disabled} model={model} />
    </div>
  );
}
const selectableProvider = (providerId: string | undefined): GitProviderSelection => {
  if (providerId === undefined) return "none";
  const known = knownGitProviderIdSchema.safeParse(providerId);
  if (known.success) return known.data;
  return "unsupported";
};
