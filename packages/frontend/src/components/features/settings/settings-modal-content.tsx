import type { ReactElement } from "react";
import { AgentRuntimesSection } from "./settings-agent-runtimes-section";
import { SettingsAppearanceSection } from "./settings-appearance-section";
import { SettingsAutopilotSection } from "./settings-autopilot-section";
import { SettingsChatSection } from "./settings-chat-section";
import type { SettingsContentFocusRequest } from "./settings-deep-link";
import { GeneralSettingsSection } from "./settings-general-section";
import { SettingsGitSection } from "./settings-git-section";
import { SettingsKanbanSection } from "./settings-kanban-section";
import type {
  PromptRoleTabId,
  RepositorySectionId,
  SettingsSectionId,
} from "./settings-modal-constants";
import { PromptOverridesSection } from "./settings-prompt-overrides-section";
import { SettingsRepositoryContent } from "./settings-repository-content";
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
  contentFocusRequest?: SettingsContentFocusRequest | null;
  onContentFocusRequestHandled?: (request: SettingsContentFocusRequest) => void;
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
  contentFocusRequest,
  onContentFocusRequestHandled,
}: SettingsModalContentProps): ReactElement {
  const {
    isLoadingSettings,
    settingsError,
    snapshotDraft,
    runtimeDefinitions,
    requiresCodexDangerAcknowledgement,
    isCodexDangerAcknowledged,
    promptValidationState,
    reusablePromptValidationState,
    globalPromptRoleTabErrorCounts,
    updateAgentRuntimes,
    setCodexDangerAcknowledged,
    updateGlobalGitConfig,
    updateGlobalGeneralSettings,
    updateGlobalAppearanceSettings,
    updateGlobalChatSettings,
    updateReusablePrompts,
    updateGlobalKanbanSettings,
    updateGlobalAutopilotSettings,
    updateGlobalPromptOverrides,
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
        runtimeCheck={controller.runtimeCheck}
        disabled={isInteractionDisabled}
        requiresCodexDangerAcknowledgement={requiresCodexDangerAcknowledgement}
        isCodexDangerAcknowledged={isCodexDangerAcknowledged}
        onCodexDangerAcknowledgedChange={setCodexDangerAcknowledged}
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

  if (section === "appearance") {
    return (
      <SettingsAppearanceSection
        appearance={snapshotDraft.appearance}
        disabled={isInteractionDisabled}
        onUpdateAppearance={updateGlobalAppearanceSettings}
      />
    );
  }

  if (section === "reusable-prompts") {
    return (
      <SettingsReusablePromptsSection
        reusablePrompts={snapshotDraft.reusablePrompts}
        selectedReusablePromptId={selectedReusablePromptId}
        validationErrors={reusablePromptValidationState.errorsById}
        disabled={isInteractionDisabled}
        onSelectedReusablePromptIdChange={onSelectedReusablePromptIdChange}
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
    <SettingsRepositoryContent
      repositorySection={repositorySection}
      repoPromptRoleTab={repoPromptRoleTab}
      isInteractionDisabled={isInteractionDisabled}
      controller={controller}
      globalPromptOverrides={snapshotDraft.globalPromptOverrides}
      onRepositorySectionChange={onRepositorySectionChange}
      onRepoPromptRoleTabChange={onRepoPromptRoleTabChange}
      contentFocusRequest={contentFocusRequest}
      onContentFocusRequestHandled={onContentFocusRequestHandled}
    />
  );
}
