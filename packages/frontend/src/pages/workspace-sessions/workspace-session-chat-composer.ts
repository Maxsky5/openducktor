import type { AgentChatComposerConfig } from "@/components/features/agents/agent-chat/use-agent-chat-composer-model";
import type { useAgentChatSend } from "@/features/agent-chat-composer/message-delivery/use-agent-chat-send";
import type { usePendingSendContext } from "@/features/agent-chat-composer/use-pending-send-context";
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
    "isStarting" | "isSavingModel" | "isResumingSession"
  >;
  delivery: ReturnType<typeof useAgentChatSend>;
  pendingSend: ReturnType<typeof usePendingSendContext>;
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
  pendingSend,
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
    foregroundTurnActive: state.foregroundTurnActive,
    isWaitingInput: isAgentSessionBlockedOnInput(state),
    waitingInputPlaceholder: getAgentSessionWaitingInputPlaceholder(state),
    canStopSession: state.canStopSession,
    stopAgentSession: stopSession,
    isResumingSession: actions.isResumingSession,
    isReadOnly: state.isReadOnly,
    readOnlyReason: state.readOnlyReason,
    draftScope: { key: draftPersistence.targetKey, persistence: draftPersistence },
    onSend: pendingSend.onSend,
    pendingSendItems: pendingSend.pendingSendItems,
    isStarting: identity === null && actions.isStarting,
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
