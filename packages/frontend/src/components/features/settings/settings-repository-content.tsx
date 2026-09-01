import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@/lib/errors";
import {
  gitProviderHealthQueryOptions,
  shouldLoadGitProviderHealth,
} from "@/state/queries/git-provider-health";
import type { SettingsContentFocusRequest } from "./settings-deep-link";
import type { PromptRoleTabId, RepositorySectionId } from "./settings-modal-constants";
import { RepositorySidebar } from "./settings-modal-sidebars";
import { buildInheritedPromptPreview } from "./settings-prompt-inheritance";
import { PromptOverridesSection } from "./settings-prompt-overrides-section";
import { RepositoryAgentsSection } from "./settings-repository-agents-section";
import { RepositoryConfigurationSection } from "./settings-repository-configuration-section";
import { RepositoryGitSection } from "./settings-repository-git-section";
import { RepositoryScriptsSection } from "./settings-repository-scripts-section";
import type { SettingsModalController } from "./use-settings-modal-controller";
import type { GitProviderHealthState } from "./use-repository-git-section-model";

type SettingsRepositoryContentProps = {
  repositorySection: RepositorySectionId;
  repoPromptRoleTab: PromptRoleTabId;
  isInteractionDisabled: boolean;
  controller: SettingsModalController;
  globalPromptOverrides: NonNullable<
    SettingsModalController["snapshotDraft"]
  >["globalPromptOverrides"];
  onRepositorySectionChange: (next: RepositorySectionId) => void;
  onRepoPromptRoleTabChange: (next: PromptRoleTabId) => void;
  contentFocusRequest?: SettingsContentFocusRequest | null | undefined;
  onContentFocusRequestHandled?: ((request: SettingsContentFocusRequest) => void) | undefined;
};

type RepositoryAvailabilityNotice = {
  message: string;
  role?: "alert";
};

const MISSING_REPOSITORY_MESSAGE_BY_SECTION = {
  configuration: "Select a repository to edit repository settings.",
  scripts: "Select a repository to edit repository scripts.",
  git: "Select a repository to edit Git provider settings.",
  agents: "Select a repository to edit agent defaults.",
  prompts: "Select a repository to configure repository-level prompts.",
} satisfies Record<RepositorySectionId, string>;

const resolveRepositoryAvailabilityNotice = ({
  repositorySection,
  requiredWorkspaceSelectionUnresolved,
  requiredWorkspaceRepoPath,
  workspaceCount,
  hasSelectedRepository,
}: {
  repositorySection: RepositorySectionId;
  requiredWorkspaceSelectionUnresolved: boolean;
  requiredWorkspaceRepoPath: string | null;
  workspaceCount: number;
  hasSelectedRepository: boolean;
}): RepositoryAvailabilityNotice | null => {
  if (workspaceCount === 0) {
    return { message: "Add a repository first, then configure repository settings." };
  }

  if (requiredWorkspaceSelectionUnresolved) {
    return {
      message: requiredWorkspaceRepoPath
        ? `The repository at ${requiredWorkspaceRepoPath} is not available in Settings. Choose a repository explicitly or close Settings.`
        : "This Agent Studio panel has no repository to configure. Choose a repository explicitly or close Settings.",
      role: "alert",
    };
  }

  if (!hasSelectedRepository) {
    return { message: MISSING_REPOSITORY_MESSAGE_BY_SECTION[repositorySection] };
  }

  return null;
};

export function SettingsRepositoryContent({
  repositorySection,
  repoPromptRoleTab,
  isInteractionDisabled,
  controller,
  globalPromptOverrides,
  onRepositorySectionChange,
  onRepoPromptRoleTabChange,
  contentFocusRequest,
  onContentFocusRequestHandled,
}: SettingsRepositoryContentProps): ReactElement {
  const {
    isLoadingSettings,
    isLoadingRuntimeDefinitions,
    isLoadingCatalog,
    isSaving,
    runtimeDefinitionsError,
    availableRuntimeDefinitions,
    catalogResources,
    favoriteState,
    workspaceIds,
    selectedWorkspace,
    selectedWorkspaceId,
    selectedRepoConfig,
    requiredWorkspaceSelectionUnresolved,
    requiredWorkspaceRepoPath,
    selectedRepoEffectiveWorktreeBasePath,
    selectedRepoBranches,
    isLoadingSelectedRepoBranches,
    selectedRepoBranchesError,
    showRepoScriptValidationErrors,
    selectedRepoDevServerValidationErrors,
    promptValidationState,
    selectedRepoPromptValidationErrors,
    selectedRepoPromptValidationErrorCount,
    selectedRepoRuntimeAvailabilityErrors,
    repoScriptValidationErrorCountByWorkspaceId,
    selectedRepoPromptRoleTabErrorCounts,
    setSelectedWorkspaceId,
    retrySelectedRepoBranchesLoad,
    updateSelectedRepoConfig,
    updateRepoPromptOverrides,
    updateSelectedRepoAgentDefault,
    clearSelectedRepoAgentDefault,
  } = controller;
  const repositoryAvailabilityNotice = resolveRepositoryAvailabilityNotice({
    repositorySection,
    requiredWorkspaceSelectionUnresolved,
    requiredWorkspaceRepoPath,
    workspaceCount: workspaceIds.length,
    hasSelectedRepository: selectedRepoConfig !== null,
  });
  const selectedRepoScriptValidationErrorCount = selectedWorkspaceId
    ? (repoScriptValidationErrorCountByWorkspaceId[selectedWorkspaceId] ?? 0)
    : 0;
  const selectedRepoPath = selectedWorkspace?.repoPath ?? "";
  const loadProviderHealth = shouldLoadGitProviderHealth({
    isGitSection: repositorySection === "git",
    provider: selectedRepoConfig?.git.provider,
    repoPath: selectedRepoPath,
  });
  const providerHealthQuery = useQuery({
    ...gitProviderHealthQueryOptions(selectedRepoPath),
    enabled: loadProviderHealth,
  });
  let providerHealth: GitProviderHealthState = { status: "idle" };
  if (loadProviderHealth) {
    if (providerHealthQuery.isPending) {
      providerHealth = { status: "pending" };
    } else if (providerHealthQuery.isError) {
      providerHealth = { status: "error", message: errorMessage(providerHealthQuery.error) };
    } else if (providerHealthQuery.data) {
      providerHealth = { status: "loaded", health: providerHealthQuery.data };
    }
  }

  return (
    <div className="grid h-full lg:grid-cols-[240px_minmax(0,1fr)]">
      <RepositorySidebar
        workspaces={controller.workspaces}
        selectedWorkspaceId={selectedWorkspaceId}
        selectedRepositorySection={repositorySection}
        disabled={isInteractionDisabled}
        selectedRepoPromptValidationErrorCount={selectedRepoPromptValidationErrorCount}
        selectedRepoScriptValidationErrorCount={selectedRepoScriptValidationErrorCount}
        repoPromptErrorCountByWorkspaceId={promptValidationState.repoErrorCountByWorkspaceId}
        repoScriptErrorCountByWorkspaceId={repoScriptValidationErrorCountByWorkspaceId}
        onSelectWorkspaceId={setSelectedWorkspaceId}
        onSelectSection={onRepositorySectionChange}
      />

      <div className="min-w-0 space-y-4">
        {repositoryAvailabilityNotice ? (
          <div
            role={repositoryAvailabilityNotice.role}
            className="rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning-surface-foreground"
          >
            {repositoryAvailabilityNotice.message}
          </div>
        ) : null}

        {selectedRepoConfig && repositorySection === "configuration" ? (
          <RepositoryConfigurationSection
            selectedRepoConfig={selectedRepoConfig}
            selectedRepoEffectiveWorktreeBasePath={selectedRepoEffectiveWorktreeBasePath}
            selectedRepoBranches={selectedRepoBranches}
            selectedRepoBranchesError={selectedRepoBranchesError}
            loadingState={{
              isLoadingSettings,
              isSaving,
              isLoadingSelectedRepoBranches,
            }}
            onRetrySelectedRepoBranchesLoad={retrySelectedRepoBranchesLoad}
            onUpdateSelectedRepoConfig={updateSelectedRepoConfig}
          />
        ) : null}

        {selectedRepoConfig && repositorySection === "scripts" ? (
          <RepositoryScriptsSection
            selectedRepoConfig={selectedRepoConfig}
            selectedRepoDevServerValidationErrors={selectedRepoDevServerValidationErrors}
            validationState={{ showDevServerValidationErrors: showRepoScriptValidationErrors }}
            loadingState={{ isLoadingSettings, isSaving }}
            focusRequest={contentFocusRequest}
            onFocusRequestHandled={onContentFocusRequestHandled}
            onUpdateSelectedRepoConfig={updateSelectedRepoConfig}
          />
        ) : null}

        {selectedRepoConfig && repositorySection === "git" ? (
          <RepositoryGitSection
            selectedRepoPath={selectedWorkspace?.repoPath ?? null}
            selectedRepoConfig={selectedRepoConfig}
            providerHealth={providerHealth}
            disabled={isInteractionDisabled}
            onDetectGithubRepository={controller.detectSelectedRepoGithubRepository}
            onUpdateSelectedRepoConfig={updateSelectedRepoConfig}
          />
        ) : null}

        {selectedRepoConfig && repositorySection === "agents" ? (
          <RepositoryAgentsSection
            selectedRepoConfig={selectedRepoConfig}
            availableRuntimeDefinitions={availableRuntimeDefinitions}
            catalogResources={catalogResources}
            favoriteState={favoriteState}
            loadingState={{
              isLoadingRuntimeDefinitions,
              isLoadingCatalog,
              isLoadingSettings,
              isSaving,
            }}
            runtimeDefinitionsError={runtimeDefinitionsError}
            runtimeAvailabilityErrors={selectedRepoRuntimeAvailabilityErrors}
            getCatalogForRuntime={controller.getCatalogForRuntime}
            isCatalogLoadingForRuntime={controller.isCatalogLoadingForRuntime}
            onUpdateSelectedRepoConfig={updateSelectedRepoConfig}
            onUpdateSelectedRepoAgentDefault={updateSelectedRepoAgentDefault}
            onClearSelectedRepoAgentDefault={clearSelectedRepoAgentDefault}
          />
        ) : null}

        {selectedRepoConfig && repositorySection === "prompts" ? (
          <PromptOverridesSection
            title="Repository Prompt Overrides"
            description="Repository overrides take precedence over global overrides when enabled."
            tab={repoPromptRoleTab}
            errorCountsByTab={selectedRepoPromptRoleTabErrorCounts}
            overrides={selectedRepoConfig.promptOverrides}
            validationErrors={selectedRepoPromptValidationErrors}
            disabled={isInteractionDisabled}
            onTabChange={onRepoPromptRoleTabChange}
            onUpdateOverrides={updateRepoPromptOverrides}
            resolveInheritedPreview={(templateId, builtinTemplate, repoOverride) =>
              buildInheritedPromptPreview(
                templateId,
                repoOverride,
                globalPromptOverrides,
                builtinTemplate,
              )
            }
          />
        ) : null}
      </div>
    </div>
  );
}
