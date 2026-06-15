import type { ChatSettings, RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentSessionTodoItem,
  AgentSkillCatalog,
  AgentSkillReference,
  AgentSlashCommand,
  AgentSlashCommandCatalog,
} from "@openducktor/core";
import type { LucideIcon } from "lucide-react";
import type { MutableRefObject, RefObject } from "react";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import type { AgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type { AgentSessionState, SessionMessagesState } from "@/types/agent-orchestrator";
export type AgentRoleOption = {
  role: AgentRole;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
};

export type AgentChatEmptyStateModel = {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  isActionPending?: boolean;
};

export type AgentChatThreadSession = Pick<
  AgentSessionState,
  | "externalSessionId"
  | "title"
  | "status"
  | "runtimeKind"
  | "workingDirectory"
  | "pendingApprovals"
  | "pendingQuestions"
  | "selectedModel"
> & {
  messages: SessionMessagesState;
  todos: AgentSessionTodoItem[];
};

export type AgentChatThreadSessionLifecycle = {
  transcriptState: AgentSessionTranscriptState;
};

export type AgentChatThreadRuntimeReadiness = {
  readinessState: "ready" | "checking" | "blocked";
  isReady: boolean;
  isRuntimeStarting: boolean;
  blockedReason: string | null;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
};

export type AgentChatThreadModel = {
  session: AgentChatThreadSession | null;
  sessionLifecycle: AgentChatThreadSessionLifecycle;
  runtimeReadiness: AgentChatThreadRuntimeReadiness;
  isTranscriptPending: boolean;
  isSessionWorking: boolean;
  isInteractionEnabled: boolean;
  emptyState: AgentChatEmptyStateModel | null;
  isStarting: boolean;
  isSending: boolean;
  sessionAgentColors: Record<string, string>;
  subagentPendingApprovalCountBySessionKey?: Record<string, number>;
  subagentPendingQuestionCountBySessionKey?: Record<string, number>;
  canSubmitQuestionAnswers: boolean;
  isSubmittingQuestionByRequestId: Record<string, boolean>;
  onSubmitQuestionAnswers: (requestId: string, answers: string[][]) => Promise<void>;
  canReplyToApprovals: boolean;
  runtimeSupportedApprovalReplyOutcomes?: readonly RuntimeApprovalReplyOutcome[] | null;
  isSubmittingApprovalByRequestId: Record<string, boolean>;
  approvalReplyErrorByRequestId: Record<string, string>;
  onReplyApproval: (requestId: string, outcome: RuntimeApprovalReplyOutcome) => Promise<void>;
  sessionRuntimeDataError: string | null;
  todoPanelCollapsed: boolean;
  onToggleTodoPanel: () => void;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  scrollToBottomOnSendRef: MutableRefObject<(() => void) | null>;
  syncBottomAfterComposerLayoutRef: MutableRefObject<(() => void) | null>;
};

export type AgentChatComposerModel = {
  taskId: string;
  displayedSessionKey: string | null;
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
  supportsProfiles?: boolean;
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  supportsSkillReferences: boolean;
  slashCommandCatalog: AgentSlashCommandCatalog | null;
  slashCommands: AgentSlashCommand[];
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
  skillCatalog: AgentSkillCatalog | null;
  skills: AgentSkillReference[];
  skillsError: string | null;
  isSkillsLoading: boolean;
  searchFiles: (query: string) => Promise<AgentFileSearchResult[]>;
  agentOptions: ComboboxOption[];
  modelOptions: ComboboxOption[];
  modelGroups: ComboboxGroup[];
  variantOptions: ComboboxOption[];
  onSelectAgent: (agent: string) => void;
  onSelectModel: (model: string) => void;
  onSelectVariant: (variant: string) => void;
  accentColor?: string | undefined;
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
  chatSettings: ChatSettings;
  thread: AgentChatThreadModel;
  composer?: AgentChatComposerModel;
};

export type AgentChatModel = AgentChatSurfaceModel & {
  composer: AgentChatComposerModel;
};
