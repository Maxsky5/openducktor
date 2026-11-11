import { globalPromptLayersOf } from "@openducktor/workflows";
import type { ReactElement } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsRemoteAccessSection } from "./settings-remote-access-section";
import { AgentRuntimesSection } from "./settings-agent-runtimes-section";
import { SettingsAppearanceSection } from "./settings-appearance-section";
import { SettingsAutopilotSection } from "./settings-autopilot-section";
import { SettingsChatSection } from "./settings-chat-section";
import type { SettingsContentFocusRequest } from "./settings-deep-link";
import { GeneralSettingsSection } from "./settings-general-section";
import { SettingsGitSection } from "./settings-git-section";
import { SettingsKanbanSection } from "./settings-kanban-section";
import { SettingsNotificationsSection } from "./settings-notifications-section";
import {
  type RepositorySectionId,
  type SettingsSectionId,
  SYSTEM_PROMPTS_TITLE,
} from "./settings-modal-constants";
import { PromptLayersSection } from "./settings-prompt-layers-section";
import type { PromptView } from "./settings-prompt-owners";
import { SettingsRepositoryContent } from "./settings-repository-content";
import { SettingsReusablePromptsSection } from "./settings-reusable-prompts-section";
import type { SettingsModalController } from "./use-settings-modal-controller";
import { SettingsCustomAgentRolesSection } from "./settings-custom-agent-roles-section";

type SettingsModalContentProps = {
  section: SettingsSectionId;
  repositorySection: RepositorySectionId;
  globalPromptView: PromptView;
  repoPromptView: PromptView;
  selectedReusablePromptId: string | null;
  selectedCustomAgentRoleId: string | null;
  onSelectedCustomAgentRoleIdChange: (next: string | null) => void;
  isInteractionDisabled: boolean;
  controller: SettingsModalController;
  onRepositorySectionChange: (next: RepositorySectionId) => void;
  onGlobalPromptViewChange: (next: PromptView) => void;
  onRepoPromptViewChange: (next: PromptView) => void;
  onSelectedReusablePromptIdChange: (next: string | null) => void;
  contentFocusRequest?: SettingsContentFocusRequest | null;
  onContentFocusRequestHandled?: (request: SettingsContentFocusRequest) => void;
};

// This flat dispatcher keeps each Settings section in its existing component.
// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function
export function SettingsModalContent({
  section,
  repositorySection,
  globalPromptView,
  repoPromptView,
  selectedReusablePromptId,
  selectedCustomAgentRoleId,
  onSelectedCustomAgentRoleIdChange,
  isInteractionDisabled,
  controller,
  onRepositorySectionChange,
  onGlobalPromptViewChange,
  onRepoPromptViewChange,
  onSelectedReusablePromptIdChange,
  contentFocusRequest,
  onContentFocusRequestHandled,
}: SettingsModalContentProps): ReactElement {
  const {
    isLoadingSettings,
    settingsError,
    snapshotDraft,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeDiscoveryError,
    runtimeExecutableValidation,
    retryRuntimeDefinitions,
    checkRuntimeExecutablesAgain,
    isCheckingRuntimeExecutables,
    requiresCodexDangerAcknowledgement,
    isCodexDangerAcknowledged,
    promptValidationState,
    reusablePromptValidationState,
    updateAgentRuntimes,
    setCodexDangerAcknowledged,
    updateGlobalGitConfig,
    updateGlobalAppearanceSettings,
    updateGlobalChatSettings,
    updateNotificationSettings,
    updateReusablePrompts,
    updateGlobalKanbanSettings,
    updateGlobalAutopilotSettings,
    savedAutopilotError,
    updateGlobalPromptLayers,
  } = controller;

  if (settingsError && !snapshotDraft) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
      >
        Failed to load settings: {settingsError}
        <Button variant="outline" onClick={controller.retrySettings}>
          <RefreshCw data-icon="inline-start" />
          Retry settings
        </Button>
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
    return <GeneralSettingsSection disabled={isInteractionDisabled} />;
  }

  if (section === "remote-access") {
    return <SettingsRemoteAccessSection />;
  }

  if (section === "custom-agent-roles") {
    return (
      <SettingsCustomAgentRolesSection
        roles={snapshotDraft.customAgentRoles}
        selectedRoleId={selectedCustomAgentRoleId}
        validation={controller.customAgentRoleValidationState}
        disabled={isInteractionDisabled}
        onSelect={onSelectedCustomAgentRoleIdChange}
        onUpdate={controller.updateCustomAgentRoles}
      />
    );
  }

  if (section === "prompts") {
    return (
      <PromptLayersSection
        title={SYSTEM_PROMPTS_TITLE}
        description="Changes apply in every repository. Repository prompts add to them."
        scope={{ kind: "global", edited: globalPromptLayersOf(snapshotDraft) }}
        validationErrors={promptValidationState.globalErrors}
        view={globalPromptView}
        disabled={isInteractionDisabled}
        onViewChange={onGlobalPromptViewChange}
        onUpdateLayers={updateGlobalPromptLayers}
      />
    );
  }

  if (section === "git") {
    return (
      <SettingsGitSection
        git={snapshotDraft.git}
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
        isLoadingRuntimeDefinitions={isLoadingRuntimeDefinitions}
        runtimeDefinitionsError={runtimeDefinitionsError}
        runtimeDiscoveryError={runtimeDiscoveryError}
        executableValidation={runtimeExecutableValidation}
        onRetryRuntimeDefinitions={retryRuntimeDefinitions}
        onCheckAgain={checkRuntimeExecutablesAgain}
        isCheckingExecutables={isCheckingRuntimeExecutables}
        disabled={isInteractionDisabled}
        requiresClaudeDangerAcknowledgement={controller.requiresClaudeDangerAcknowledgement}
        isClaudeDangerAcknowledged={controller.isClaudeDangerAcknowledged}
        onClaudeDangerAcknowledgedChange={controller.setClaudeDangerAcknowledged}
        requiresCodexDangerAcknowledgement={requiresCodexDangerAcknowledgement}
        isCodexDangerAcknowledged={isCodexDangerAcknowledged}
        onCodexDangerAcknowledgedChange={setCodexDangerAcknowledged}
        onUpdateAgentRuntimes={updateAgentRuntimes}
        focusRequest={
          contentFocusRequest?.kind === "runtime-executable" ? contentFocusRequest : null
        }
        onFocusRequestHandled={onContentFocusRequestHandled}
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
        system={snapshotDraft.system}
        onUpdateSystem={controller.updateGlobalSystemSettings}
        disabled={isInteractionDisabled}
        onUpdateAppearance={updateGlobalAppearanceSettings}
      />
    );
  }

  if (section === "notifications") {
    return (
      <SettingsNotificationsSection
        notifications={snapshotDraft.notifications}
        disabled={isInteractionDisabled}
        onUpdateNotifications={updateNotificationSettings}
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
        disabled={isInteractionDisabled || savedAutopilotError !== null}
        loadError={savedAutopilotError}
        onUpdateAutopilot={updateGlobalAutopilotSettings}
      />
    );
  }

  return (
    <SettingsRepositoryContent
      repositorySection={repositorySection}
      repoPromptView={repoPromptView}
      globalPromptLayers={globalPromptLayersOf(snapshotDraft)}
      isInteractionDisabled={isInteractionDisabled}
      controller={controller}
      onRepositorySectionChange={onRepositorySectionChange}
      onRepoPromptViewChange={onRepoPromptViewChange}
      contentFocusRequest={contentFocusRequest}
      onContentFocusRequestHandled={onContentFocusRequestHandled}
    />
  );
}
