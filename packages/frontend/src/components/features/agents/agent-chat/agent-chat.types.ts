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

export type AgentChatMode = "interactive" | "non_interactive";

export type AgentChatEmptyStateModel = {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  isActionPending?: boolean;
};

export type AgentChatThreadModel = {
  session: AgentSessionState | null;
  isSessionWorking: boolean;
  showThinkingMessages: boolean;
  isSessionViewLoading: boolean;
  isSessionHistoryLoading: boolean;
  isWaitingForRuntimeReadiness: boolean;
  readinessState: "ready" | "checking" | "blocked";
  isInteractionEnabled: boolean;
  blockedReason: string | null;
  isLoadingChecks: boolean;
  onRefreshChecks: () => void;
  emptyState?: AgentChatEmptyStateModel | null;
  isStarting: boolean;
  isSending: boolean;
  sessionAgentColors: Record<string, string>;
  subagentPendingPermissionCountBySessionId?: Record<string, number>;
  canSubmitQuestionAnswers: boolean;
  isSubmittingQuestionByRequestId: Record<string, boolean>;
  onSubmitQuestionAnswers: (requestId: string, answers: string[][]) => Promise<void>;
  canReplyToPermissions: boolean;
  isSubmittingPermissionByRequestId: Record<string, boolean>;
  permissionReplyErrorByRequestId: Record<string, string>;
  onReplyPermission: (requestId: string, reply: "once" | "always" | "reject") => Promise<void>;
  sessionRuntimeDataError: string | null;
  todoPanelCollapsed: boolean;
  onToggleTodoPanel: () => void;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  scrollToBottomOnSendRef: MutableRefObject<(() => void) | null>;
  syncBottomAfterComposerLayoutRef: MutableRefObject<(() => void) | null>;
};

export type AgentChatComposerModel = {
  taskId: string;
  displayedSessionId: string | null;
  isInteractionEnabled: boolean;
  isReadOnly: boolean;
  readOnlyReason: string | null;
  busySendBlockedReason: string | null;
  pendingInlineCommentCount: number;
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

export type AgentChatSurfaceModel = {
  mode: AgentChatMode;
  thread: AgentChatThreadModel;
  composer?: AgentChatComposerModel;
};

export type AgentChatModel = AgentChatSurfaceModel & {
  mode: "interactive";
  composer: AgentChatComposerModel;
};
