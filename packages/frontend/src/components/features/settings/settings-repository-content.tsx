import { repoPromptLayersOf, type PromptSettingsLayers } from "@openducktor/workflows";
import {
  gitRepositoryKey,
  type GitProviderRepository,
  type RepositoryGitProviderContext,
  type SettingsSnapshot,
} from "@openducktor/contracts";
import {
  azureDevOpsRepositoryKey,
  isAzureDevOpsRepository,
  gitlabRepositoryKey,
  isGitlabRepository,
} from "@openducktor/core";
import { type ReactElement, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { repositoryGitProviderContextQueryOptionsOrSkip } from "@openducktor/frontend-core/queries/git-provider-context";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import type { SettingsContentFocusRequest } from "./settings-deep-link";
import { REPOSITORY_PROMPTS_TITLE, type RepositorySectionId } from "./settings-modal-constants";
import { RepositorySidebar } from "./settings-modal-sidebars";
import { PromptLayersSection } from "./settings-prompt-layers-section";
import { PROMPT_HOME_VIEW, type PromptView } from "./settings-prompt-owners";
import { RepositoryAgentsSection } from "./settings-repository-agents-section";
import { RepositoryConfigurationSection } from "./settings-repository-configuration-section";
import { RepositoryGitSection } from "./settings-repository-git-section";
import { RepositoryScriptsSection } from "./settings-repository-scripts-section";
import type { SettingsModalController } from "./use-settings-modal-controller";
import type { GitProviderState } from "./use-repository-git-section-model";

type SettingsRepositoryContentProps = {
  repositorySection: RepositorySectionId;
  repoPromptView: PromptView;
  /** The draft System prompts layers that Repository prompts build on. */
  globalPromptLayers: PromptSettingsLayers;
  isInteractionDisabled: boolean;
  controller: SettingsModalController;
  onRepositorySectionChange: (next: RepositorySectionId) => void;
  onRepoPromptViewChange: (next: PromptView) => void;
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
  hasUnavailableDraft,
}: {
  repositorySection: RepositorySectionId;
  requiredWorkspaceSelectionUnresolved: boolean;
  requiredWorkspaceRepoPath: string | null;
  workspaceCount: number;
  hasSelectedRepository: boolean;
  hasUnavailableDraft: boolean;
}): RepositoryAvailabilityNotice | null => {
  if (hasUnavailableDraft) {
    return {
      message:
        "This workspace is no longer available. Your unsaved settings remain below. Copy any text you need, then use Cancel to discard the draft. Save cannot update this workspace.",
      role: "alert",
    };
  }

  if (workspaceCount === 0) {
    return { message: "Add a repository first, then configure repository settings." };
  }

  if (requiredWorkspaceSelectionUnresolved) {
    return {
      message: requiredWorkspaceRepoPath
        ? `The repository at ${requiredWorkspaceRepoPath} is not available in Settings. Choose a repository explicitly or close Settings.`
        : "This task workflow panel has no repository to configure. Choose a repository explicitly or close Settings.",
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

const providerRepositoryKey = (repository: GitProviderRepository): string => {
  if (isAzureDevOpsRepository(repository)) return azureDevOpsRepositoryKey(repository);
  if (isGitlabRepository(repository)) return gitlabRepositoryKey(repository);
  return gitRepositoryKey(repository);
};

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
    (draftProvider?.repository ? providerRepositoryKey(draftProvider.repository) : null) !==
      (savedProvider?.repository ? providerRepositoryKey(savedProvider.repository) : null) ||
    JSON.stringify(draftProvider?.settings?.remoteMappings ?? []) !==
      JSON.stringify(savedProvider?.settings?.remoteMappings ?? []) ||
    draftProvider?.settings?.httpConsentCollectionUrl !==
      savedProvider?.settings?.httpConsentCollectionUrl ||
    draftProvider?.settings?.areaPath !== savedProvider?.settings?.areaPath
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
  repoPromptView,
  globalPromptLayers,
  isInteractionDisabled,
  controller,
  onRepositorySectionChange,
  onRepoPromptViewChange,
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
    selectedWorkspace,
    selectedWorkspaceId,
    selectedRepoConfig,
    requiredWorkspaceSelectionUnresolved,
    requiredWorkspaceRepoPath,
    selectedRepoEffectiveWorktreeBasePath,
    selectedRepoBranches,
    isLoadingSelectedRepoBranches,
    selectedRepoBranchesError,
    promptValidationState,
    selectedRepoPromptValidationErrors,
    selectedRepoPromptValidationErrorCount,
    selectedRepoModelWarnings,
    setSelectedWorkspaceId,
    retrySelectedRepoBranchesLoad,
    updateSelectedRepoConfig,
    updateRepoPromptLayers,
    updateSelectedRepoAgentDefault,
    clearSelectedRepoAgentDefault,
    updateSelectedRepoDefaultModel,
    clearSelectedRepoDefaultModel,
  } = controller;
  const selectableWorkspaces = useMemo(() => {
    const liveWorkspaceIds = new Set(
      controller.workspaces.map((workspace) => workspace.workspaceId),
    );
    const unavailableDrafts = Object.values(snapshotDraft?.workspaces ?? {})
      .filter((workspace) => !liveWorkspaceIds.has(workspace.workspaceId))
      .map((workspace) => ({
        workspaceId: workspace.workspaceId,
        workspaceName: `${workspace.workspaceName} (unavailable draft)`,
        repoPath: workspace.repoPath,
      }));
    return [...controller.workspaces, ...unavailableDrafts];
  }, [controller.workspaces, snapshotDraft?.workspaces]);
  const repositoryAvailabilityNotice = resolveRepositoryAvailabilityNotice({
    repositorySection,
    requiredWorkspaceSelectionUnresolved,
    requiredWorkspaceRepoPath,
    workspaceCount: selectableWorkspaces.length,
    hasSelectedRepository: selectedRepoConfig !== null,
    hasUnavailableDraft: selectedRepoConfig !== null && selectedWorkspace === null,
  });
  const selectedRepoPath = selectedWorkspace?.repoPath ?? "";
  const savedSettings = useQuery(settingsSnapshotQueryOptions()).data;
  const providerDirty = hasProviderEdits(snapshotDraft, savedSettings, selectedWorkspaceId);
  const loadProviderContext = shouldLoadProvider({
    providerDirty,
    repositorySection,
    repoPath: selectedRepoPath,
  });
  const providerContextQuery = useQuery({
    ...repositoryGitProviderContextQueryOptionsOrSkip(selectedWorkspace),
    enabled: loadProviderContext,
  });
  const providerState = getProviderState(providerDirty, loadProviderContext, providerContextQuery);

  return (
    <div className="grid min-h-full min-w-0 grid-cols-1 grid-rows-[auto_1fr] lg:grid-cols-[240px_minmax(0,1fr)] lg:grid-rows-1">
      <RepositorySidebar
        workspaces={selectableWorkspaces}
        selectedWorkspaceId={selectedWorkspaceId}
        selectedRepositorySection={repositorySection}
        disabled={isInteractionDisabled}
        selectedRepoPromptValidationErrorCount={selectedRepoPromptValidationErrorCount}
        repoPromptErrorCountByWorkspaceId={promptValidationState.repoErrorCountByWorkspaceId}
        onSelectWorkspaceId={(workspaceId) => {
          setSelectedWorkspaceId(workspaceId);
          // Repository prompts start again from the first screen of the other repository.
          onRepoPromptViewChange(PROMPT_HOME_VIEW);
        }}
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
            savedGitProvider={controller.savedSelectedRepoGitProvider}
            providerState={providerState}
            disabled={isInteractionDisabled}
            onDetectGithubRepository={controller.detectSelectedRepoGithubRepository}
            onSaveSettings={controller.submit}
            onGitProviderValidationChange={controller.setGitProviderValidationErrorCount}
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
            modelWarnings={selectedRepoModelWarnings}
            getCatalogForRuntime={controller.getCatalogForRuntime}
            isCatalogLoadingForRuntime={controller.isCatalogLoadingForRuntime}
            onUpdateSelectedRepoConfig={updateSelectedRepoConfig}
            onUpdateSelectedRepoAgentDefault={updateSelectedRepoAgentDefault}
            onClearSelectedRepoAgentDefault={clearSelectedRepoAgentDefault}
            onUpdateSelectedRepoDefaultModel={updateSelectedRepoDefaultModel}
            onClearSelectedRepoDefaultModel={clearSelectedRepoDefaultModel}
          />
        ) : null}

        {selectedRepoConfig && repositorySection === "prompts" ? (
          // The key also resets the search and the filter of the other repository.
          <PromptLayersSection
            key={selectedRepoPath}
            title={REPOSITORY_PROMPTS_TITLE}
            description="Changes apply in this repository, on top of the System prompts."
            scope={{
              kind: "repository",
              edited: repoPromptLayersOf(selectedRepoConfig),
              inherited: globalPromptLayers,
            }}
            validationErrors={selectedRepoPromptValidationErrors}
            view={repoPromptView}
            disabled={isInteractionDisabled}
            onViewChange={onRepoPromptViewChange}
            onUpdateLayers={updateRepoPromptLayers}
          />
        ) : null}
      </div>
    </div>
  );
}
