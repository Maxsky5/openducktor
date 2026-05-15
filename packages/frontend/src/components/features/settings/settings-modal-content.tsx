import type { ReactElement } from "react";
import { AgentRuntimesSection } from "./settings-agent-runtimes-section";
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
import { RepositorySidebar } from "./settings-modal-sidebars";
import { buildInheritedPromptPreview } from "./settings-prompt-inheritance";
import { PromptOverridesSection } from "./settings-prompt-overrides-section";
import { RepositoryAgentsSection } from "./settings-repository-agents-section";
import { RepositoryConfigurationSection } from "./settings-repository-configuration-section";
import { RepositoryGitSection } from "./settings-repository-git-section";
import { SettingsReusablePromptsSection } from "./settings-reusable-prompts-section";
import type { SettingsModalController } from "./use-settings-modal-controller";

type SettingsModalContentProps = {
  section: SettingsSectionId;
  repositorySection: RepositorySectionId;
  globalPromptRoleTab: PromptRoleTabId;
  repoPromptRoleTab: PromptRoleTabId;
  selectedReusablePromptId: string | null;
  isInteractionDisabled: boolean;
  controller: SettingsModalController;
  onRepositorySectionChange: (next: RepositorySectionId) => void;
  onGlobalPromptRoleTabChange: (next: PromptRoleTabId) => void;
  onRepoPromptRoleTabChange: (next: PromptRoleTabId) => void;
  onSelectedReusablePromptIdChange: (next: string | null) => void;
};

export function SettingsModalContent({
  section,
  repositorySection,
  globalPromptRoleTab,
  repoPromptRoleTab,
  selectedReusablePromptId,
  isInteractionDisabled,
  controller,
  onRepositorySectionChange,
  onGlobalPromptRoleTabChange,
  onRepoPromptRoleTabChange,
  onSelectedReusablePromptIdChange,
}: SettingsModalContentProps): ReactElement {
  const {
    isLoadingSettings,
    isLoadingRuntimeDefinitions,
    isLoadingCatalog,
    isSaving,
    settingsError,
    runtimeDefinitionsError,
    snapshotDraft,
    runtimeDefinitions,
    availableRuntimeDefinitions,
    updateAgentRuntimes,
    getCatalogForRuntime,
    getCatalogErrorForRuntime,
    isCatalogLoadingForRuntime,
    workspaceIds,
    selectedWorkspace,
    selectedWorkspaceId,
    selectedRepoConfig,
    selectedRepoEffectiveWorktreeBasePath,
    selectedRepoBranches,
    isLoadingSelectedRepoBranches,
    selectedRepoBranchesError,
    showRepoScriptValidationErrors,
    selectedRepoDevServerValidationErrors,
    promptValidationState,
    reusablePromptValidationState,
    selectedRepoRuntimeAvailabilityErrors,
    selectedRepoPromptValidationErrors,
    selectedRepoPromptValidationErrorCount,
    globalPromptRoleTabErrorCounts,
    selectedRepoPromptRoleTabErrorCounts,
    setSelectedWorkspaceId,
    retrySelectedRepoBranchesLoad,
    updateSelectedRepoConfig,
    updateGlobalGitConfig,
    updateGlobalGeneralSettings,
    updateGlobalChatSettings,
    updateReusablePrompts,
    updateGlobalKanbanSettings,
    updateGlobalAutopilotSettings,
    updateGlobalPromptOverrides,
    updateRepoPromptOverrides,
    updateSelectedRepoAgentDefault,
    clearSelectedRepoAgentDefault,
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
        Loading settings…
      </div>
    );
  }

  if (section === "general") {
    return (
      <GeneralSettingsSection
        general={snapshotDraft.general}
        disabled={isInteractionDisabled}
        onUpdateGeneral={updateGlobalGeneralSettings}
      />
    );
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

  if (section === "runtimes") {
    return (
      <AgentRuntimesSection
        agentRuntimes={snapshotDraft.agentRuntimes}
        runtimeDefinitions={runtimeDefinitions}
        disabled={isInteractionDisabled}
        onUpdateAgentRuntimes={updateAgentRuntimes}
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

  if (section === "reusable-prompts") {
    return (
      <SettingsReusablePromptsSection
        reusablePrompts={snapshotDraft.reusablePrompts}
        selectedReusablePromptId={selectedReusablePromptId ?? null}
        validationErrors={reusablePromptValidationState.errorsById}
        disabled={isInteractionDisabled}
        onSelectedReusablePromptIdChange={onSelectedReusablePromptIdChange ?? (() => {})}
        onUpdateReusablePrompts={updateReusablePrompts}
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
        workspaces={controller.workspaces}
        selectedWorkspaceId={selectedWorkspaceId}
        selectedRepositorySection={repositorySection}
        disabled={isInteractionDisabled}
        selectedRepoPromptValidationErrorCount={selectedRepoPromptValidationErrorCount}
        repoPromptErrorCountByWorkspaceId={promptValidationState.repoErrorCountByWorkspaceId}
        onSelectWorkspaceId={setSelectedWorkspaceId}
        onSelectSection={onRepositorySectionChange}
      />

      <div className="min-w-0 space-y-4">
        {workspaceIds.length === 0 ? (
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
            loadingState={{
              isLoadingSettings: isLoadingSettings,
              isSaving: isSaving,
              isLoadingSelectedRepoBranches: isLoadingSelectedRepoBranches,
            }}
            onRetrySelectedRepoBranchesLoad={retrySelectedRepoBranchesLoad}
            validationState={{
              showDevServerValidationErrors: showRepoScriptValidationErrors,
            }}
            selectedRepoDevServerValidationErrors={selectedRepoDevServerValidationErrors}
            onUpdateSelectedRepoConfig={updateSelectedRepoConfig}
          />
        ) : null}

        {repositorySection === "git" ? (
          <RepositoryGitSection
            selectedRepoPath={selectedWorkspace?.repoPath ?? null}
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
            availableRuntimeDefinitions={availableRuntimeDefinitions}
            loadingState={{
              isLoadingRuntimeDefinitions,
              isLoadingCatalog,
              isLoadingSettings,
              isSaving,
            }}
            runtimeDefinitionsError={runtimeDefinitionsError}
            runtimeAvailabilityErrors={selectedRepoRuntimeAvailabilityErrors}
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
                buildInheritedPromptPreview(
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
