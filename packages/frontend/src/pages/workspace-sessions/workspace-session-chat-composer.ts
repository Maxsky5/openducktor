import type { AgentChatComposerConfig } from "@/components/features/agents/agent-chat/use-agent-chat-composer-model";
import type { useAgentChatSend } from "@/features/agent-chat-composer/message-delivery/use-agent-chat-send";
import type { useReviewCommentComposer } from "@/features/agent-chat-composer/use-review-comment-composer";
import type { useSelectedSessionContextUsage } from "@/features/agent-chat-composer/context-usage/use-selected-session-context-usage";
import {
  getAgentSessionWaitingInputPlaceholder,
  isAgentSessionBlockedOnInput,
} from "@openducktor/frontend-core/lib/agent-session-waiting-input";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import type { projectWorkspaceSessionChatState } from "./workspace-session-chat-state";
import type { createWorkspaceSessionChatDraftPersistence } from "./workspace-session-chat-draft";
import type { useWorkspaceSessionChatActions } from "./use-workspace-session-chat-actions";
import type { useWorkspaceSessionModelPicker } from "./use-workspace-session-model-picker";
import type { useWorkspaceSessionPromptInput } from "./use-workspace-session-prompt-input";

type WorkspaceSessionComposerInput = {
  state: ReturnType<typeof projectWorkspaceSessionChatState>;
  identity: AgentSessionIdentity | null;
  actions: Pick<
    ReturnType<typeof useWorkspaceSessionChatActions>,
    "isStarting" | "isSavingModel" | "isResumingSession" | "isPrepared" | "error"
  >;
  delivery: ReturnType<typeof useAgentChatSend>;
  reviewComments: Pick<ReturnType<typeof useReviewCommentComposer>, "onSend" | "pendingSendItems">;
  draftPersistence: ReturnType<typeof createWorkspaceSessionChatDraftPersistence>;
  picker: ReturnType<typeof useWorkspaceSessionModelPicker>;
  promptInput: ReturnType<typeof useWorkspaceSessionPromptInput>;
  contextUsage: ReturnType<typeof useSelectedSessionContextUsage>;
  stopSession: AgentOperationsContextValue["stopAgentSession"];
};

export function buildWorkspaceSessionComposer({
  state,
  identity,
  actions,
  delivery,
  reviewComments,
  draftPersistence,
  picker,
  promptInput,
  contextUsage,
  stopSession,
}: WorkspaceSessionComposerInput): AgentChatComposerConfig {
  const { support, slashCommands, skills, subagents, searchFiles, refreshCatalogIfStale } =
    promptInput;
  return {
    ...delivery,
    displayedSessionKey: state.sessionKey,
    selectedSession: identity ? { ...identity, selectedModel: state.selectedModel } : null,
    isSessionModelCatalogLoading: picker.isLoading,
    isSessionWorking: state.isWorking,
    isWaitingInput: isAgentSessionBlockedOnInput(state),
    waitingInputPlaceholder: getAgentSessionWaitingInputPlaceholder(state),
    canStopSession: state.canStopSession,
    stopAgentSession: stopSession,
    isResumingSession: actions.isResumingSession,
    isReadOnly: state.isReadOnly || !actions.isPrepared,
    readOnlyReason:
      state.readOnlyReason ??
      actions.error ??
      (!actions.isPrepared ? "Preparing the session..." : null),
    draftScope: { key: draftPersistence.targetKey, persistence: draftPersistence },
    onSend: reviewComments.onSend,
    pendingSendItems: reviewComments.pendingSendItems ?? undefined,
    isStarting: actions.isStarting,
    isSavingModel: actions.isSavingModel,
    contextUsage,
    selectedModelSelection: picker.selection,
    speed: picker.speed,
    selectedModelDescriptor: picker.selectedModelEntry,
    isSelectionCatalogLoading: picker.isLoading,
    supportsProfiles: picker.supportsProfiles,
    supportsAttachments: support.supportsAttachments,
    supportsFileSearch: support.supportsFileSearch,
    supportsSkillReferences: support.supportsSkillReferences,
    supportsSubagentReferences: support.supportsSubagentReferences,
    ...slashCommands,
    ...skills,
    ...subagents,
    onCatalogMenuOpen: refreshCatalogIfStale,
    onAgentSelectorOpen: refreshCatalogIfStale,
    onVariantSelectorOpen: refreshCatalogIfStale,
    searchFiles,
    agentOptions: picker.agentProfileOptions,
    variantOptions: picker.variantOptions,
    onSelectAgent: picker.handleSelectAgentProfile,
    onSelectVariant: picker.handleSelectVariant,
    modelPicker: picker.modelPicker,
  };
}
