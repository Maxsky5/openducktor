import type { AgentChatComposerConfig } from "@/components/features/agents/agent-chat/use-agent-chat-composer-model";
import { useAgentChatSend } from "@openducktor/frontend-core/sessions/send/use-agent-chat-send";
import { usePendingSendContext } from "@/features/agent-chat-composer/use-pending-send-context";
import { documentVisibility } from "@/features/session-navigation/document-visibility";
import { useHandoffModelPicker } from "@/components/features/agents/agent-chat/use-handoff-model-picker";
import type { useRuntimeHandoff } from "@openducktor/frontend-core/sessions/send/runtime-handoff";
import type { WorkspaceRef, WorkspaceSession } from "@openducktor/contracts";
import type { useSelectedSessionContextUsage } from "@openducktor/frontend-core/sessions/composer/context-usage/use-selected-session-context-usage";
import {
  getAgentSessionWaitingInputPlaceholder,
  isAgentSessionBlockedOnInput,
} from "@openducktor/frontend-core/lib/agent-session-waiting-input";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import type { projectWorkspaceSessionChatState } from "@openducktor/frontend-core/workspace-sessions/chat/workspace-session-chat-state";
import type { createWorkspaceSessionChatDraftPersistence } from "@openducktor/frontend-core/sessions/composer/workspace-session-chat-draft";
import type { useWorkspaceSessionChatActions } from "./use-workspace-session-chat-actions";
import type {
  useWorkspaceSessionCreateModelPicker,
  useWorkspaceSessionModelPicker,
} from "./use-workspace-session-model-picker";
import type { SessionPromptInput } from "@openducktor/frontend-core/sessions/composer/prompt-input/use-session-prompt-input";

type WorkspaceSessionComposerPicker = Pick<
  ReturnType<typeof useWorkspaceSessionModelPicker> &
    ReturnType<typeof useWorkspaceSessionCreateModelPicker>,
  | "selection"
  | "speed"
  | "selectedModelEntry"
  | "isLoading"
  | "supportsProfiles"
  | "agentProfileOptions"
  | "variantOptions"
  | "handleSelectAgentProfile"
  | "handleSelectVariant"
> & {
  modelPicker: AgentChatComposerConfig["modelPicker"];
};

export function useWorkspaceSessionChatDelivery({
  workspace,
  record,
  modelPicker,
  handoff,
  send,
}: {
  workspace: WorkspaceRef;
  record: WorkspaceSession;
  modelPicker: AgentChatComposerConfig["modelPicker"];
  handoff: ReturnType<typeof useRuntimeHandoff>;
  send: Omit<Parameters<typeof useAgentChatSend>[0], "handoff">;
}) {
  const owner = {
    kind: "workspace_session" as const,
    workspaceId: workspace.workspaceId,
    sessionId: record.id,
  };
  const handoffModelPicker = useHandoffModelPicker(modelPicker, handoff);
  const messageDelivery = useAgentChatSend({ ...send, handoff });
  const pendingSendContext = usePendingSendContext({
    owner,
    workingDirectory: record.executionTarget.workingDirectory,
    onSend: messageDelivery.onSend,
    visibility: documentVisibility,
  });
  return { messageDelivery, handoffModelPicker, pendingSendContext };
}

export function buildComposerCatalogFields(
  picker: WorkspaceSessionComposerPicker,
  promptInput: Pick<
    SessionPromptInput,
    "support" | "slashCommands" | "skills" | "subagents" | "refreshCatalogIfStale" | "searchFiles"
  >,
) {
  const { support, slashCommands, skills, subagents, searchFiles, refreshCatalogIfStale } =
    promptInput;
  return {
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
    searchFiles,
    agentOptions: picker.agentProfileOptions,
    variantOptions: picker.variantOptions,
    onSelectAgent: picker.handleSelectAgentProfile,
    onSelectVariant: picker.handleSelectVariant,
    modelPicker: picker.modelPicker,
  };
}

type WorkspaceSessionComposerInput = {
  state: ReturnType<typeof projectWorkspaceSessionChatState>;
  identity: AgentSessionIdentity | null;
  isStartupPending: boolean;
  actions: Pick<
    ReturnType<typeof useWorkspaceSessionChatActions>,
    "isStarting" | "isResumingSession"
  >;
  delivery: ReturnType<typeof useAgentChatSend>;
  goalRow: AgentChatComposerConfig["goalRow"];
  goalRowScope: AgentChatComposerConfig["goalRowScope"];
  backgroundTasks: AgentChatComposerConfig["backgroundTasks"];
  pendingSend: ReturnType<typeof usePendingSendContext>;
  draftPersistence: ReturnType<typeof createWorkspaceSessionChatDraftPersistence>;
  picker: Omit<ReturnType<typeof useWorkspaceSessionModelPicker>, "modelPicker"> & {
    modelPicker: AgentChatComposerConfig["modelPicker"];
  };
  promptInput: SessionPromptInput;
  contextUsage: ReturnType<typeof useSelectedSessionContextUsage>;
  stopSession: AgentOperationsContextValue["stopAgentSession"];
};

export function buildWorkspaceSessionComposer({
  state,
  identity,
  isStartupPending,
  actions,
  delivery,
  goalRow,
  goalRowScope,
  backgroundTasks,
  pendingSend,
  draftPersistence,
  picker,
  promptInput,
  contextUsage,
  stopSession,
}: WorkspaceSessionComposerInput): AgentChatComposerConfig {
  return {
    ...delivery,
    goalRow,
    goalRowScope,
    backgroundTasks,
    displayedSessionKey: state.sessionKey,
    selectedSession: identity,
    isSessionWorking: state.isWorking,
    foregroundTurnActive: state.foregroundTurnActive,
    isWaitingInput: isAgentSessionBlockedOnInput(state),
    waitingInputPlaceholder: getAgentSessionWaitingInputPlaceholder(state),
    canStopSession: state.canStopSession,
    stopAgentSession: stopSession,
    isResumingSession: actions.isResumingSession,
    isReadOnly: isStartupPending || state.isReadOnly,
    readOnlyReason: isStartupPending ? "Starting session..." : state.readOnlyReason,
    draftScope: { key: draftPersistence.targetKey, persistence: draftPersistence },
    onSend: pendingSend.onSend,
    pendingSendItems: pendingSend.pendingSendItems,
    isStarting: isStartupPending || (identity === null && actions.isStarting),
    contextUsage,
    ...buildComposerCatalogFields(picker, promptInput),
  };
}
