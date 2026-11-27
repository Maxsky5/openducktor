import type { AgentMessageSubmitMode, WorkspaceSession } from "@openducktor/contracts";
import { useCallback, useMemo, useRef, useState } from "react";
import type { AgentChatComposerDraft } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import type { WorkspaceSessionDraft } from "@openducktor/frontend-core/drafts/new-workspace-session-draft-store";
import { useWorkspaceChatSettings } from "@openducktor/frontend-core/queries/use-workspace-chat-settings";
import type { AgentChatSendResult } from "@openducktor/frontend-core/sessions/send/agent-chat-send-result";
import { useWorkspaceSessionDraftCore } from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-draft-core";
import { resolveAgentSessionAccentColor } from "@/components/features/agents/agent-accent-color";
import type { AgentChatComposerModel } from "@/components/features/agents/agent-chat/agent-chat.types";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useCreateModelPickerProps } from "./use-workspace-session-model-picker";
import { buildComposerCatalogFields } from "./workspace-session-chat-composer";

export type WorkspaceSessionDraftViewProps = {
  workspace: ActiveWorkspace;
  draft: WorkspaceSessionDraft;
  onDiscard: () => void;
  onSwitchWorkspace?: ((workspaceId: string) => void) | undefined;
  onSavedRecord: (
    record: WorkspaceSession,
    startupAttemptId: string,
    draftId: string,
  ) => boolean | void;
};

const NOOP = (): void => {};

export function useWorkspaceSessionDraftController({
  workspace,
  draft,
  onDiscard,
  onSavedRecord,
}: Omit<WorkspaceSessionDraftViewProps, "onSwitchWorkspace">) {
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const composerFormRef = useRef<HTMLFormElement | null>(null);
  const composerEditorRef = useRef<HTMLDivElement | null>(null);
  const scrollToBottomOnSendRef = useRef<(() => void) | null>(null);

  const core = useWorkspaceSessionDraftCore({
    workspaceId: workspace.workspaceId,
    repoPath: workspace.repoPath,
    draft,
  });
  const { chatSettings, chatSettingsError, retryChatSettingsLoad } = useWorkspaceChatSettings({
    hasWorkspace: true,
  });
  const picker = useCreateModelPickerProps(core.model);

  const { actions, composerPersistence, promptInput, startup, validation } = core;
  const { isStarting, showingTranscript, readOnlyReason } = startup;

  const handleSend = useCallback(
    async (
      submittedComposer: AgentChatComposerDraft,
      _mode: AgentMessageSubmitMode,
    ): Promise<AgentChatSendResult> => {
      const outcome = await actions.submit({
        submittedComposer,
        onSavedRecord: (record, startupAttemptId) => {
          onSavedRecord(record, startupAttemptId, draft.id);
        },
      });
      return outcome !== null && !outcome.error;
    },
    [actions, draft.id, onSavedRecord],
  );

  const {
    selection: pickerSelection,
    speed: pickerSpeed,
    selectedModelEntry: pickerSelectedModelEntry,
    isLoading: pickerIsLoading,
    supportsProfiles: pickerSupportsProfiles,
    agentProfileOptions: pickerAgentProfileOptions,
    variantOptions: pickerVariantOptions,
    handleSelectAgentProfile: pickerHandleSelectAgentProfile,
    handleSelectVariant: pickerHandleSelectVariant,
    modelPicker: pickerModelPicker,
    runtimeKind: selectedRuntimeKind,
  } = picker;
  const {
    support: promptSupport,
    slashCommands: promptSlashCommands,
    skills: promptSkills,
    subagents: promptSubagents,
    refreshCatalogIfStale: promptRefreshCatalogIfStale,
    searchFiles: promptSearchFiles,
  } = promptInput;

  const composerModel = useMemo<AgentChatComposerModel>(
    () => ({
      displayedSessionKey: `workspace-draft:${draft.id}`,
      isInteractionEnabled: !isStarting,
      isReadOnly: showingTranscript,
      canSend: !showingTranscript && validation.canSubmit,
      readOnlyReason,
      externalSendBlockedReason: showingTranscript ? null : validation.fieldErrors.composer,
      draftScope: { key: composerPersistence.targetKey, persistence: composerPersistence },
      onSend: handleSend,
      isSending: isStarting,
      isStarting,
      isSessionWorking: false,
      isWaitingInput: false,
      waitingInputPlaceholder: null,
      steerBlockedReason: null,
      runningTurnModel: null,
      messageQueue: null,
      goalRow: null,
      goalRowScope: null,
      backgroundTasks: null,
      ...buildComposerCatalogFields(
        {
          selection: pickerSelection,
          speed: pickerSpeed,
          selectedModelEntry: pickerSelectedModelEntry,
          isLoading: pickerIsLoading,
          supportsProfiles: pickerSupportsProfiles,
          agentProfileOptions: pickerAgentProfileOptions,
          variantOptions: pickerVariantOptions,
          handleSelectAgentProfile: pickerHandleSelectAgentProfile,
          handleSelectVariant: pickerHandleSelectVariant,
          modelPicker: pickerModelPicker,
        },
        {
          support: promptSupport,
          slashCommands: promptSlashCommands,
          skills: promptSkills,
          subagents: promptSubagents,
          refreshCatalogIfStale: promptRefreshCatalogIfStale,
          searchFiles: promptSearchFiles,
        },
      ),
      accentColor: resolveAgentSessionAccentColor({ runtimeKind: selectedRuntimeKind }),
      contextUsage: null,
      canStopSession: false,
      onStopSession: NOOP,
      isResumingSession: false,
      composerFormRef,
      composerEditorRef,
      onComposerEditorInput: NOOP,
      scrollToBottomOnSendRef,
    }),
    [
      composerPersistence,
      draft.id,
      handleSend,
      isStarting,
      pickerAgentProfileOptions,
      pickerHandleSelectAgentProfile,
      pickerHandleSelectVariant,
      pickerIsLoading,
      pickerModelPicker,
      pickerSelectedModelEntry,
      pickerSelection,
      pickerSpeed,
      pickerSupportsProfiles,
      pickerVariantOptions,
      promptRefreshCatalogIfStale,
      promptSearchFiles,
      promptSkills,
      promptSlashCommands,
      promptSubagents,
      promptSupport,
      readOnlyReason,
      selectedRuntimeKind,
      showingTranscript,
      validation.canSubmit,
      validation.fieldErrors.composer,
    ],
  );

  const handleDiscardClick = useCallback(() => {
    if (actions.discardPolicy === "blocked") return;
    if (actions.discardPolicy === "immediate") {
      onDiscard();
      return;
    }
    setDiscardConfirmOpen(true);
  }, [actions.discardPolicy, onDiscard]);

  const { refetch: refetchRepoConfig } = core.optionsModel.repoConfig;
  const retryRepoConfig = useCallback((): void => {
    void refetchRepoConfig();
  }, [refetchRepoConfig]);

  return {
    composerModel,
    optionsModel: core.optionsModel,
    startup,
    chatSettings: {
      value: chatSettings,
      error: chatSettingsError,
      onRetry: retryChatSettingsLoad,
    },
    banners: {
      repoConfigError: core.optionsModel.repoConfig.isError
        ? core.optionsModel.repoConfig.error
        : null,
      onRetryRepoConfig: retryRepoConfig,
      preSaveError: core.hostValidationError ? null : core.preSaveError,
    },
    discard: {
      confirmOpen: discardConfirmOpen,
      setConfirmOpen: setDiscardConfirmOpen,
      onClick: handleDiscardClick,
    },
  };
}
