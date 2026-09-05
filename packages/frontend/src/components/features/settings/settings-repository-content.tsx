import type { RepositoryGitProviderContext, SettingsSnapshot } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@/lib/errors";
import { repositoryGitProviderContextQueryOptions } from "@/state/queries/git-provider-context";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
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
import type { GitProviderState } from "./use-repository-git-section-model";

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

const getProviderState = (
  providerDirty: boolean,
  loadProviderContext: boolean,
  query: {
    data: RepositoryGitProviderContext | undefined;
    error: Error | null;
    isError: boolean;
    isPending: boolean;
  },
): GitProviderState => {
  if (providerDirty) {
    return { status: "draft" };
  }
  if (!loadProviderContext) {
    return { status: "idle" };
  }
  if (query.isPending) {
    return { status: "pending" };
  }
  if (query.isError) {
    return { status: "error", message: errorMessage(query.error) };
  }
  return query.data !== undefined ? { status: "loaded", context: query.data } : { status: "idle" };
};

const shouldLoadProvider = ({
  providerDirty,
  repositorySection,
  repoPath,
}: {
  providerDirty: boolean;
  repositorySection: RepositorySectionId;
  repoPath: string;
}): boolean => !providerDirty && repositorySection === "git" && repoPath.length > 0;

const hasProviderEdits = (
  draft: SettingsSnapshot | null,
  saved: SettingsSnapshot | undefined,
  workspaceId: string | null,
): boolean => {
  if (!workspaceId) {
    return false;
  }
  const draftProvider = draft?.workspaces[workspaceId]?.git.provider;
  const savedProvider = saved?.workspaces[workspaceId]?.git.provider;
  return (
    draftProvider?.id !== savedProvider?.id ||
    draftProvider?.enabled !== savedProvider?.enabled ||
    draftProvider?.repository?.host !== savedProvider?.repository?.host ||
    draftProvider?.repository?.owner !== savedProvider?.repository?.owner ||
    draftProvider?.repository?.name !== savedProvider?.repository?.name
  );
};

const RepositoryAvailabilityBanner = ({
  notice,
}: {
  notice: RepositoryAvailabilityNotice | null;
}): ReactElement | null => {
  if (!notice) {
    return null;
  }
  return (
    <div
      role={notice.role}
      className="rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning-surface-foreground"
    >
      {notice.message}
    </div>
  );
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
    snapshotDraft,
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
  const savedSettings = useQuery(settingsSnapshotQueryOptions()).data;
  const providerDirty = hasProviderEdits(snapshotDraft, savedSettings, selectedWorkspaceId);
  const loadProviderContext = shouldLoadProvider({
    providerDirty,
    repositorySection,
    repoPath: selectedRepoPath,
  });
  const providerContextQuery = useQuery({
    ...repositoryGitProviderContextQueryOptions(selectedRepoPath),
    enabled: loadProviderContext,
  });
  const providerState = getProviderState(providerDirty, loadProviderContext, providerContextQuery);

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
        <RepositoryAvailabilityBanner notice={repositoryAvailabilityNotice} />

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
            providerState={providerState}
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
