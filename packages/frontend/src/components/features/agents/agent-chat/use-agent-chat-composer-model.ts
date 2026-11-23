import type { AgentChatSendResult } from "@openducktor/frontend-core/sessions/send/agent-chat-send-result";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
} from "@openducktor/core";
import { type MutableRefObject, type RefObject, useMemo } from "react";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { AgentMessageSubmitMode } from "@openducktor/contracts";
import type { AgentChatComposerModel } from "./agent-chat.types";
import type { AgentChatComposerDraft } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { resolveAgentSessionAccentColor } from "../agent-accent-color";
import type { AgentChatDraftScope } from "@openducktor/frontend-core/sessions/send/agent-chat-draft-scope";

type StopAgentSession = (session: AgentSessionIdentity) => Promise<void>;

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
  selectedSession: AgentSessionIdentity | null;
  isSessionWorking: boolean;
  foregroundTurnActive?: boolean | undefined;
  isWaitingInput: boolean;
  waitingInputPlaceholder: string | null;
  canStopSession: boolean;
  stopAgentSession: StopAgentSession;
  isResumingSession: boolean;
  isReadOnly: boolean;
  canSend?: boolean;
  readOnlyReason: string | null;
  pendingSendItems?: AgentChatComposerModel["pendingSendItems"];
  draftScope: AgentChatDraftScope;
  onSend: AgentChatComposerModel["onSend"];
  steerBlockedReason: string | null;
  runningTurnModel: AgentChatComposerModel["runningTurnModel"];
  messageQueue: AgentChatComposerModel["messageQueue"];
  goalRow: AgentChatComposerModel["goalRow"];
  goalRowScope: AgentChatComposerModel["goalRowScope"];
  backgroundTasks: AgentChatComposerModel["backgroundTasks"];
  isSending: boolean;
  isStarting: boolean;
  contextUsage: {
    totalTokens: number;
    contextWindow: number;
    outputLimit?: number;
  } | null;
  selectedModelSelection: AgentModelSelection | null;
  speed: AgentChatComposerModel["speed"];
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
  retrySlashCommands: (() => void) | null;
  skillCatalog: AgentChatComposerModel["skillCatalog"];
  skills: AgentChatComposerModel["skills"];
  skillsError: string | null;
  isSkillsLoading: boolean;
  retrySkills: (() => void) | null;
  subagentCatalog: AgentChatComposerModel["subagentCatalog"];
  subagents: AgentChatComposerModel["subagents"];
  subagentsError: string | null;
  isSubagentsLoading: boolean;
  retrySubagents: (() => void) | null;
  onCatalogMenuOpen: () => void;
  onAgentSelectorOpen: () => void;
  onVariantSelectorOpen: () => void;
  searchFiles: (query: string) => Promise<AgentFileSearchResult[]>;
  agentOptions: ComboboxOption[];
  modelPicker: AgentChatComposerModel["modelPicker"];
  variantOptions: ComboboxOption[];
  onSelectAgent: (agent: string) => void;
  onSelectVariant: (variant: string) => void;
};

type UseAgentChatComposerModelArgs = {
  composer: AgentChatComposerConfig | undefined;
  interactionEnabled: boolean;
  composerFormRef: RefObject<HTMLFormElement | null>;
  composerEditorRef: RefObject<HTMLDivElement | null>;
  resizeComposerEditor: () => void;
  scrollToBottomOnSendRef: MutableRefObject<(() => void) | null>;
};

export function useAgentChatComposerModel({
  composer,
  interactionEnabled,
  composerFormRef,
  composerEditorRef,
  resizeComposerEditor,
  scrollToBottomOnSendRef,
}: UseAgentChatComposerModelArgs): AgentChatComposerModel | undefined {
  return useMemo(() => {
    if (!composer) {
      return undefined;
    }

    const model: AgentChatComposerModel = {
      displayedSessionKey: composer.displayedSessionKey,
      isInteractionEnabled: interactionEnabled,
      isReadOnly: composer.isReadOnly,
      canSend: composer.canSend ?? true,
      readOnlyReason: composer.readOnlyReason,
      draftScope: composer.draftScope,
      onSend: async (
        draft: AgentChatComposerDraft,
        mode: AgentMessageSubmitMode,
      ): Promise<AgentChatSendResult> => {
        scrollToBottomOnSendRef.current?.();
        return composer.onSend(draft, mode);
      },
      steerBlockedReason: composer.steerBlockedReason,
      runningTurnModel: composer.runningTurnModel,
      messageQueue: composer.messageQueue,
      goalRow: composer.goalRow,
      goalRowScope: composer.goalRowScope,
      backgroundTasks: composer.backgroundTasks,
      isSending: composer.isSending,
      isStarting: composer.isStarting,
      isSessionWorking: composer.isSessionWorking,
      foregroundTurnActive: composer.foregroundTurnActive,
      isWaitingInput: composer.isWaitingInput,
      waitingInputPlaceholder: composer.waitingInputPlaceholder,
      selectedModelSelection: composer.selectedModelSelection,
      speed: composer.speed,
      isSelectionCatalogLoading: composer.isSelectionCatalogLoading,
      supportsAttachments: composer.supportsAttachments,
      supportsSlashCommands: composer.supportsSlashCommands,
      supportsFileSearch: composer.supportsFileSearch,
      supportsSkillReferences: composer.supportsSkillReferences,
      supportsSubagentReferences: composer.supportsSubagentReferences,
      slashCommandCatalog: composer.slashCommandCatalog,
      slashCommands: composer.slashCommands,
      slashCommandsError: composer.slashCommandsError,
      isSlashCommandsLoading: composer.isSlashCommandsLoading,
      retrySlashCommands: composer.retrySlashCommands,
      skillCatalog: composer.skillCatalog,
      skills: composer.skills,
      skillsError: composer.skillsError,
      isSkillsLoading: composer.isSkillsLoading,
      retrySkills: composer.retrySkills,
      subagentCatalog: composer.subagentCatalog,
      subagents: composer.subagents,
      subagentsError: composer.subagentsError,
      isSubagentsLoading: composer.isSubagentsLoading,
      retrySubagents: composer.retrySubagents,
      onCatalogMenuOpen: composer.onCatalogMenuOpen,
      onAgentSelectorOpen: composer.onAgentSelectorOpen,
      onVariantSelectorOpen: composer.onVariantSelectorOpen,
      searchFiles: composer.searchFiles,
      agentOptions: composer.agentOptions,
      modelPicker: composer.modelPicker,
      variantOptions: composer.variantOptions,
      onSelectAgent: composer.onSelectAgent,
      onSelectVariant: composer.onSelectVariant,
      accentColor: resolveAgentSessionAccentColor({
        runtimeKind:
          composer.selectedSession?.runtimeKind ??
          composer.selectedModelSelection?.runtimeKind ??
          null,
      }),
      contextUsage: composer.contextUsage,
      canStopSession: composer.canStopSession,
      onStopSession: () =>
        invokeStopAgentSession(composer.selectedSession, composer.stopAgentSession),
      isResumingSession: composer.isResumingSession,
      composerFormRef,
      composerEditorRef,
      onComposerEditorInput: resizeComposerEditor,
      scrollToBottomOnSendRef,
    };
    if (composer.pendingSendItems) {
      model.pendingSendItems = composer.pendingSendItems;
    }
    if (composer.selectedModelDescriptor !== undefined) {
      model.selectedModelDescriptor = composer.selectedModelDescriptor;
    }
    if (composer.supportsProfiles !== undefined) {
      model.supportsProfiles = composer.supportsProfiles;
    }
    return model;
  }, [
    composer,
    interactionEnabled,
    composerEditorRef,
    composerFormRef,
    resizeComposerEditor,
    scrollToBottomOnSendRef,
  ]);
}
