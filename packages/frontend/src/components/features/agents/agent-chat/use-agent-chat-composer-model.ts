import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
} from "@openducktor/core";
import { type MutableRefObject, type RefObject, useMemo } from "react";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { AgentChatComposerModel } from "./agent-chat.types";
import type { AgentChatComposerDraft } from "./agent-chat-composer-draft";
import { deriveAgentChatComposerModelState } from "./agent-chat-composer-model-state";
import type { AgentChatDraftScope } from "./agent-chat-draft-scope";

type StopAgentSession = (session: AgentSessionIdentity) => Promise<void>;
type AgentChatComposerSelectedSession = AgentSessionIdentity & {
  selectedModel: AgentModelSelection | null;
};

export const invokeStopAgentSession = (
  session: AgentSessionIdentity | null,
  stopAgentSession: StopAgentSession | undefined,
): void => {
  if (!session || !stopAgentSession) {
    return;
  }
  void stopAgentSession(session).catch(() => undefined);
};

export type AgentChatComposerConfig = {
  displayedSessionKey: string | null;
  selectedSession: AgentChatComposerSelectedSession | null;
  isSessionModelCatalogLoading: boolean;
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  waitingInputPlaceholder: string | null;
  busySendBlockedReason: string | null;
  canStopSession: boolean;
  stopAgentSession: StopAgentSession;
  isReadOnly: boolean;
  readOnlyReason: string | null;
  pendingSendItems?: AgentChatComposerModel["pendingSendItems"];
  draftScope: AgentChatDraftScope;
  onSend: (draft: AgentChatComposerDraft) => Promise<boolean>;
  isSending: boolean;
  isStarting: boolean;
  contextUsage: {
    totalTokens: number;
    contextWindow: number;
    outputLimit?: number;
  } | null;
  selectedModelSelection: AgentModelSelection | null;
  selectedModelDescriptor?: AgentModelCatalog["models"][number] | null | undefined;
  isSelectionCatalogLoading: boolean;
  supportsProfiles?: boolean;
  supportsAttachments: boolean;
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  supportsSkillReferences: boolean;
  supportsSubagentReferences: boolean;
  slashCommandCatalog: AgentChatComposerModel["slashCommandCatalog"];
  slashCommands: AgentChatComposerModel["slashCommands"];
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
  skillCatalog: AgentChatComposerModel["skillCatalog"];
  skills: AgentChatComposerModel["skills"];
  skillsError: string | null;
  isSkillsLoading: boolean;
  subagentCatalog: AgentChatComposerModel["subagentCatalog"];
  subagents: AgentChatComposerModel["subagents"];
  subagentsError: string | null;
  isSubagentsLoading: boolean;
  searchFiles: (query: string) => Promise<AgentFileSearchResult[]>;
  agentOptions: ComboboxOption[];
  modelPickerRuntimes: AgentChatComposerModel["modelPickerRuntimes"];
  modelPickerSelectionPolicy: AgentChatComposerModel["modelPickerSelectionPolicy"];
  favoriteState: AgentChatComposerModel["favoriteState"];
  variantOptions: ComboboxOption[];
  onSelectAgent: (agent: string) => void;
  onSelectModelPair: AgentChatComposerModel["onSelectModelPair"];
  onModelPickerOpenChange: AgentChatComposerModel["onModelPickerOpenChange"];
  onSelectVariant: (variant: string) => void;
};

type UseAgentChatComposerModelArgs = {
  composer: AgentChatComposerConfig | undefined;
  interactionEnabled: boolean;
  sessionAgentColors: Record<string, string>;
  composerFormRef: RefObject<HTMLFormElement | null>;
  composerEditorRef: RefObject<HTMLDivElement | null>;
  resizeComposerEditor: () => void;
  scrollToBottomOnSendRef: MutableRefObject<(() => void) | null>;
  syncBottomAfterComposerLayoutRef: MutableRefObject<(() => void) | null>;
};

export function useAgentChatComposerModel({
  composer,
  interactionEnabled,
  sessionAgentColors,
  composerFormRef,
  composerEditorRef,
  resizeComposerEditor,
  scrollToBottomOnSendRef,
  syncBottomAfterComposerLayoutRef,
}: UseAgentChatComposerModelArgs): AgentChatComposerModel | undefined {
  const composerState = useMemo(
    () =>
      composer
        ? deriveAgentChatComposerModelState({
            selectedSession: composer.selectedSession,
            selectedModelSelection: composer.selectedModelSelection,
            isSessionModelCatalogLoading: composer.isSessionModelCatalogLoading,
            isInteractionEnabled: interactionEnabled,
            sessionAgentColors,
          })
        : null,
    [composer, interactionEnabled, sessionAgentColors],
  );

  return useMemo(() => {
    if (!composer) {
      return undefined;
    }

    return {
      displayedSessionKey: composer.displayedSessionKey,
      isInteractionEnabled: composerState?.isInteractionEnabled ?? false,
      isReadOnly: composer.isReadOnly,
      readOnlyReason: composer.readOnlyReason,
      busySendBlockedReason: composer.busySendBlockedReason,
      ...(composer.pendingSendItems ? { pendingSendItems: composer.pendingSendItems } : {}),
      draftScope: composer.draftScope,
      onSend: async (draft: AgentChatComposerDraft): Promise<boolean> => {
        scrollToBottomOnSendRef.current?.();
        return composer.onSend(draft);
      },
      isSending: composer.isSending,
      isStarting: composer.isStarting,
      isSessionWorking: composer.isSessionWorking,
      isWaitingInput: composer.isWaitingInput,
      waitingInputPlaceholder: composer.waitingInputPlaceholder,
      isModelSelectionPending: composerState?.isModelSelectionPending ?? false,
      selectedModelSelection: composer.selectedModelSelection,
      ...(composer.selectedModelDescriptor !== undefined
        ? { selectedModelDescriptor: composer.selectedModelDescriptor }
        : {}),
      isSelectionCatalogLoading: composer.isSelectionCatalogLoading,
      ...(composer.supportsProfiles !== undefined
        ? { supportsProfiles: composer.supportsProfiles }
        : {}),
      supportsAttachments: composer.supportsAttachments,
      supportsSlashCommands: composer.supportsSlashCommands,
      supportsFileSearch: composer.supportsFileSearch,
      supportsSkillReferences: composer.supportsSkillReferences,
      supportsSubagentReferences: composer.supportsSubagentReferences,
      slashCommandCatalog: composer.slashCommandCatalog,
      slashCommands: composer.slashCommands,
      slashCommandsError: composer.slashCommandsError,
      isSlashCommandsLoading: composer.isSlashCommandsLoading,
      skillCatalog: composer.skillCatalog,
      skills: composer.skills,
      skillsError: composer.skillsError,
      isSkillsLoading: composer.isSkillsLoading,
      subagentCatalog: composer.subagentCatalog,
      subagents: composer.subagents,
      subagentsError: composer.subagentsError,
      isSubagentsLoading: composer.isSubagentsLoading,
      searchFiles: composer.searchFiles,
      agentOptions: composer.agentOptions,
      modelPickerRuntimes: composer.modelPickerRuntimes,
      modelPickerSelectionPolicy: composer.modelPickerSelectionPolicy,
      favoriteState: composer.favoriteState,
      variantOptions: composer.variantOptions,
      onSelectAgent: composer.onSelectAgent,
      onSelectModelPair: composer.onSelectModelPair,
      onModelPickerOpenChange: composer.onModelPickerOpenChange,
      onSelectVariant: composer.onSelectVariant,
      accentColor: composerState?.accentColor,
      contextUsage: composer.contextUsage,
      canStopSession: composer.canStopSession,
      onStopSession: () =>
        invokeStopAgentSession(composer.selectedSession, composer.stopAgentSession),
      composerFormRef,
      composerEditorRef,
      onComposerEditorInput: resizeComposerEditor,
      scrollToBottomOnSendRef,
      syncBottomAfterComposerLayoutRef,
    };
  }, [
    composer,
    composerState,
    composerEditorRef,
    composerFormRef,
    resizeComposerEditor,
    scrollToBottomOnSendRef,
    syncBottomAfterComposerLayoutRef,
  ]);
}
