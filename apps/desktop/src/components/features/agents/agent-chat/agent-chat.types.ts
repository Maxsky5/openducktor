import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentSlashCommand,
  AgentSlashCommandCatalog,
} from "@openducktor/core";
import type { LucideIcon } from "lucide-react";
import type { MutableRefObject, RefObject } from "react";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import type { AgentSessionState } from "@/types/agent-orchestrator";
export type AgentRoleOption = {
  role: AgentRole;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
};

export type AgentChatThreadModel = {
  session: AgentSessionState | null;
  isSessionWorking: boolean;
  showThinkingMessages: boolean;
  isSessionViewLoading: boolean;
  isSessionHistoryLoading: boolean;
  isWaitingForRuntimeReadiness: boolean;
  roleOptions: AgentRoleOption[];
  readinessState: "ready" | "checking" | "blocked";
  agentStudioReady: boolean;
  blockedReason: string | null;
  isLoadingChecks: boolean;
  onRefreshChecks: () => void;
  taskSelected: boolean;
  canKickoffNewSession: boolean;
  kickoffLabel: string;
  onKickoff: () => void;
  isStarting: boolean;
  isSending: boolean;
  sessionAgentColors: Record<string, string>;
  isSubmittingQuestionByRequestId: Record<string, boolean>;
  onSubmitQuestionAnswers: (requestId: string, answers: string[][]) => Promise<void>;
  isSubmittingPermissionByRequestId: Record<string, boolean>;
  permissionReplyErrorByRequestId: Record<string, string>;
  onReplyPermission: (requestId: string, reply: "once" | "always" | "reject") => Promise<void>;
  todoPanelCollapsed: boolean;
  onToggleTodoPanel: () => void;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  scrollToBottomOnSendRef: MutableRefObject<(() => void) | null>;
  syncBottomAfterComposerLayoutRef: MutableRefObject<(() => void) | null>;
};

export type AgentChatComposerModel = {
  taskId: string;
  agentStudioReady: boolean;
  isReadOnly: boolean;
  readOnlyReason: string | null;
  busySendBlockedReason: string | null;
  draftStateKey: string;
  onSend: (draft: import("./agent-chat-composer-draft").AgentChatComposerDraft) => Promise<boolean>;
  isSending: boolean;
  isStarting: boolean;
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  waitingInputPlaceholder?: string | null;
  isModelSelectionPending: boolean;
  selectedModelSelection: AgentModelSelection | null;
  selectedModelDescriptor?: AgentModelCatalog["models"][number] | null;
  isSelectionCatalogLoading: boolean;
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  slashCommandCatalog: AgentSlashCommandCatalog | null;
  slashCommands: AgentSlashCommand[];
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
  searchFiles: (query: string) => Promise<AgentFileSearchResult[]>;
  agentOptions: ComboboxOption[];
  modelOptions: ComboboxOption[];
  modelGroups: ComboboxGroup[];
  variantOptions: ComboboxOption[];
  onSelectAgent: (agent: string) => void;
  onSelectModel: (model: string) => void;
  onSelectVariant: (variant: string) => void;
  sessionAgentColors?: Record<string, string>;
  contextUsage: {
    totalTokens: number;
    contextWindow: number;
    outputLimit?: number;
  } | null;
  canStopSession: boolean;
  onStopSession: () => void;
  composerFormRef: RefObject<HTMLFormElement | null>;
  composerEditorRef: RefObject<HTMLDivElement | null>;
  onComposerEditorInput: () => void;
  scrollToBottomOnSendRef: MutableRefObject<(() => void) | null>;
  syncBottomAfterComposerLayoutRef: MutableRefObject<(() => void) | null>;
};

export type AgentChatModel = {
  thread: AgentChatThreadModel;
  composer: AgentChatComposerModel;
};
