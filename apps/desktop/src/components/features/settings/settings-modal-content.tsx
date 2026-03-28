import type { ReactElement } from "react";
import { SettingsAutopilotSection } from "./settings-autopilot-section";
import { SettingsChatSection } from "./settings-chat-section";
import { GeneralSettingsSection } from "./settings-general-section";
import { SettingsGitSection } from "./settings-git-section";
import { SettingsKanbanSection } from "./settings-kanban-section";
import type {
  PromptRoleTabId,
  RepositorySectionId,
  SettingsSectionId,
} from "./settings-modal-constants";
import { resolveInheritedPromptPreview } from "./settings-modal-normalization";
import { RepositorySidebar } from "./settings-modal-sidebars";
import { PromptOverridesSection } from "./settings-prompt-overrides-section";
import { RepositoryAgentsSection } from "./settings-repository-agents-section";
import { RepositoryConfigurationSection } from "./settings-repository-configuration-section";
import { RepositoryGitSection } from "./settings-repository-git-section";
import type { SettingsModalController } from "./use-settings-modal-controller";

type SettingsModalContentProps = {
  section: SettingsSectionId;
  repositorySection: RepositorySectionId;
  globalPromptRoleTab: PromptRoleTabId;
  repoPromptRoleTab: PromptRoleTabId;
  isInteractionDisabled: boolean;
  controller: SettingsModalController;
  onRepositorySectionChange: (next: RepositorySectionId) => void;
  onGlobalPromptRoleTabChange: (next: PromptRoleTabId) => void;
  onRepoPromptRoleTabChange: (next: PromptRoleTabId) => void;
};

export function SettingsModalContent({
  section,
  repositorySection,
  globalPromptRoleTab,
  repoPromptRoleTab,
  isInteractionDisabled,
  controller,
  onRepositorySectionChange,
  onGlobalPromptRoleTabChange,
  onRepoPromptRoleTabChange,
}: SettingsModalContentProps): ReactElement {
  const {
    isLoadingSettings,
    isLoadingRuntimeDefinitions,
    isLoadingCatalog,
    isSaving,
    isPickingWorktreeBasePath,
    settingsError,
    runtimeDefinitionsError,
    snapshotDraft,
    runtimeDefinitions,
    getCatalogForRuntime,
    getCatalogErrorForRuntime,
    isCatalogLoadingForRuntime,
    repoPaths,
    selectedRepoPath,
    selectedRepoConfig,
    selectedRepoEffectiveWorktreeBasePath,
    selectedRepoBranches,
    isLoadingSelectedRepoBranches,
    selectedRepoBranchesError,
    showRepoScriptValidationErrors,
    selectedRepoDevServerValidationErrors,
    promptValidationState,
    selectedRepoPromptValidationErrors,
    selectedRepoPromptValidationErrorCount,
    globalPromptRoleTabErrorCounts,
    selectedRepoPromptRoleTabErrorCounts,
    setSelectedRepoPath,
    retrySelectedRepoBranchesLoad,
    updateSelectedRepoConfig,
    updateGlobalGitConfig,
    updateGlobalChatSettings,
    updateGlobalKanbanSettings,
    updateGlobalAutopilotSettings,
    updateGlobalPromptOverrides,
    updateRepoPromptOverrides,
    updateSelectedRepoAgentDefault,
    clearSelectedRepoAgentDefault,
    pickWorktreeBasePath,
  } = controller;

  if (settingsError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        Failed to load settings: {settingsError}
      </div>
    );
  }

  if (isLoadingSettings || !snapshotDraft) {
    return (
      <div className="rounded-md border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
        Loading settings...
      </div>
    );
  }

  if (section === "general") {
    return <GeneralSettingsSection />;
  }

  if (section === "prompts") {
    return (
      <PromptOverridesSection
        title="Global Prompt Overrides"
        description="Global overrides apply to every repository unless a repository-specific enabled override exists for the same prompt."
        tab={globalPromptRoleTab}
        errorCountsByTab={globalPromptRoleTabErrorCounts}
        overrides={snapshotDraft.globalPromptOverrides}
        validationErrors={promptValidationState.globalErrors}
        disabled={isInteractionDisabled}
        onTabChange={onGlobalPromptRoleTabChange}
        onUpdateOverrides={updateGlobalPromptOverrides}
        resolveInheritedPreview={(_templateId, builtinTemplate, override) =>
          override && override.enabled !== false
            ? undefined
            : {
                sourceLabel: "Builtin prompt",
                template: builtinTemplate,
              }
        }
      />
    );
  }

  if (section === "git") {
    return (
      <SettingsGitSection
        git={snapshotDraft.git}
        runtimeCheck={controller.runtimeCheck}
        disabled={isInteractionDisabled}
        onUpdateGit={updateGlobalGitConfig}
      />
    );
  }

  if (section === "chat") {
    return (
      <SettingsChatSection
        chat={snapshotDraft.chat}
        disabled={isInteractionDisabled}
        onUpdateChat={updateGlobalChatSettings}
      />
    );
  }

  if (section === "kanban") {
    return (
      <SettingsKanbanSection
        kanban={snapshotDraft.kanban}
        disabled={isInteractionDisabled}
        onUpdateKanban={updateGlobalKanbanSettings}
      />
    );
  }

  if (section === "autopilot") {
    return (
      <SettingsAutopilotSection
        autopilot={snapshotDraft.autopilot}
        disabled={isInteractionDisabled}
        onUpdateAutopilot={updateGlobalAutopilotSettings}
      />
    );
  }

  return (
    <div className="grid h-full lg:grid-cols-[240px_minmax(0,1fr)]">
      <RepositorySidebar
        repoPaths={repoPaths}
        selectedRepoPath={selectedRepoPath}
        selectedRepositorySection={repositorySection}
        disabled={isInteractionDisabled}
        selectedRepoPromptValidationErrorCount={selectedRepoPromptValidationErrorCount}
        repoPromptErrorCountByPath={promptValidationState.repoErrorCountByPath}
        onSelectRepoPath={setSelectedRepoPath}
        onSelectSection={onRepositorySectionChange}
      />

      <div className="min-w-0 space-y-4">
        {repoPaths.length === 0 ? (
          <div className="rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning-surface-foreground">
            Add a repository first, then configure repository settings.
          </div>
        ) : null}

        {repositorySection === "configuration" ? (
          <RepositoryConfigurationSection
            selectedRepoConfig={selectedRepoConfig}
            selectedRepoEffectiveWorktreeBasePath={selectedRepoEffectiveWorktreeBasePath}
            selectedRepoBranches={selectedRepoBranches}
            selectedRepoBranchesError={selectedRepoBranchesError}
            isLoadingSettings={isLoadingSettings}
            isSaving={isSaving}
            isPickingWorktreeBasePath={isPickingWorktreeBasePath}
            isLoadingSelectedRepoBranches={isLoadingSelectedRepoBranches}
            onRetrySelectedRepoBranchesLoad={retrySelectedRepoBranchesLoad}
            onPickWorktreeBasePath={pickWorktreeBasePath}
            showDevServerValidationErrors={showRepoScriptValidationErrors}
            selectedRepoDevServerValidationErrors={selectedRepoDevServerValidationErrors}
            onUpdateSelectedRepoConfig={updateSelectedRepoConfig}
          />
        ) : null}

        {repositorySection === "git" ? (
          <RepositoryGitSection
            selectedRepoPath={selectedRepoPath}
            selectedRepoConfig={selectedRepoConfig}
            runtimeCheck={controller.runtimeCheck}
            disabled={isInteractionDisabled}
            onDetectGithubRepository={controller.detectSelectedRepoGithubRepository}
            onUpdateSelectedRepoConfig={updateSelectedRepoConfig}
          />
        ) : null}

        {repositorySection === "agents" ? (
          <RepositoryAgentsSection
            selectedRepoConfig={selectedRepoConfig}
            runtimeDefinitions={runtimeDefinitions}
            isLoadingRuntimeDefinitions={isLoadingRuntimeDefinitions}
            isLoadingCatalog={isLoadingCatalog}
            isLoadingSettings={isLoadingSettings}
            isSaving={isSaving}
            runtimeDefinitionsError={runtimeDefinitionsError}
            getCatalogForRuntime={getCatalogForRuntime}
            getCatalogErrorForRuntime={getCatalogErrorForRuntime}
            isCatalogLoadingForRuntime={isCatalogLoadingForRuntime}
            onUpdateSelectedRepoConfig={updateSelectedRepoConfig}
            onUpdateSelectedRepoAgentDefault={updateSelectedRepoAgentDefault}
            onClearSelectedRepoAgentDefault={clearSelectedRepoAgentDefault}
          />
        ) : null}

        {repositorySection === "prompts" ? (
          selectedRepoConfig ? (
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
                resolveInheritedPromptPreview(
                  templateId,
                  repoOverride,
                  snapshotDraft.globalPromptOverrides,
                  builtinTemplate,
                )
              }
            />
          ) : (
            <div className="rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning-surface-foreground">
              Select a repository to configure repository-level prompts.
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
