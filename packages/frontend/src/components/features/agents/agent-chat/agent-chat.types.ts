import type {
  ChatSettings,
  RuntimeApprovalReplyOutcome,
  RuntimeKind,
} from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentSessionTodoItem,
  AgentSkillCatalog,
  AgentSkillReference,
  AgentSlashCommand,
  AgentSlashCommandCatalog,
  AgentSubagentCatalog,
  AgentSubagentReference,
} from "@openducktor/core";
import type { MutableRefObject, RefObject } from "react";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionIdentity,
  SessionMessagesState,
} from "@/types/agent-orchestrator";
import type { AgentSessionActivityState } from "@/types/agent-session-activity";
import type { AgentChatDraftScope } from "./agent-chat-draft-scope";
import type { AgentSessionTranscriptTarget } from "./agent-session-transcript-target";

export type AgentChatEmptyStateModel = {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  isActionPending?: boolean;
};

export type AgentChatTranscriptSession = AgentSessionIdentity & {
  title?: string;
  activityState: AgentSessionActivityState | null;
  runtimeStatusMessage: string | null;
  messages: SessionMessagesState;
};

export type AgentChatTranscriptNoticeAction = {
  label: string;
  onAction: () => void;
  disabled?: boolean;
  isPending?: boolean;
};

export type AgentChatTranscriptNotice = {
  kind:
    | "runtime_waiting"
    | "session_loading"
    | "session_failed"
    | "session_history_warning"
    | "runtime_blocked";
  severity: "loading" | "error";
  title: string;
  description: string;
  details?: Array<{ label: string; value: string }>;
  action?: AgentChatTranscriptNoticeAction;
};

type AgentChatTranscriptPresentationBase = {
  target: AgentSessionTranscriptTarget | null;
  displayedSessionKey: string | null;
  notice: AgentChatTranscriptNotice | null;
};

export type AgentChatTranscriptPresentation = AgentChatTranscriptPresentationBase &
  (
    | {
        kind: "session";
        session: AgentChatTranscriptSession;
        shouldResetWindow: false;
      }
    | {
        kind: "empty";
        session: null;
        shouldResetWindow: boolean;
      }
  );

export type AgentChatToolCallPresentation = {
  kind: "regular" | "workflow";
  displayName: string;
};

export type AgentChatRuntimePresentation = {
  runtimeKind: RuntimeKind | null;
  presentToolCall: (toolName: string, displayLabel?: string) => AgentChatToolCallPresentation;
  supportedApprovalReplyOutcomes: readonly RuntimeApprovalReplyOutcome[] | null;
};

export type AgentChatThreadModel = {
  modelCatalog: AgentModelCatalog | null;
  transcript: AgentChatTranscriptPresentation;
  runtimePresentation: AgentChatRuntimePresentation;
  isSessionWorking: boolean;
  isInteractionEnabled: boolean;
  emptyState: AgentChatEmptyStateModel | null;
  isStarting: boolean;
  isSending: boolean;
  sessionAgentColors: Record<string, string>;
  pendingApprovalRequests: readonly AgentApprovalRequest[];
  pendingQuestionRequests: readonly AgentQuestionRequest[];
  subagentPendingApprovalCountBySessionKey?: Record<string, number>;
  subagentPendingQuestionCountBySessionKey?: Record<string, number>;
  todos: readonly AgentSessionTodoItem[];
  sessionAccentColor?: string | undefined;
  canSubmitQuestionAnswers: boolean;
  isSubmittingQuestionByRequestId: Record<string, boolean>;
  onSubmitQuestionAnswers: (requestId: string, answers: string[][]) => Promise<void>;
  canReplyToApprovals: boolean;
  isSubmittingApprovalByRequestId: Record<string, boolean>;
  approvalReplyErrorByRequestId: Record<string, string>;
  onReplyApproval: (requestId: string, outcome: RuntimeApprovalReplyOutcome) => Promise<void>;
  sessionAuxiliaryError: string | null;
  todoPanelCollapsed: boolean;
  onToggleTodoPanel: () => void;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  scrollToBottomOnSendRef: MutableRefObject<(() => void) | null>;
  syncBottomAfterComposerLayoutRef: MutableRefObject<(() => void) | null>;
};

export type AgentChatPendingSendItems = {
  count: number;
  accessibleLabel: string;
};

export type AgentChatComposerModel = {
  displayedSessionKey: string | null;
  isInteractionEnabled: boolean;
  isReadOnly: boolean;
  readOnlyReason: string | null;
  busySendBlockedReason: string | null;
  pendingSendItems?: AgentChatPendingSendItems;
  draftScope: AgentChatDraftScope;
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
  supportsAttachments: boolean;
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  supportsSkillReferences: boolean;
  supportsSubagentReferences: boolean;
  slashCommandCatalog: AgentSlashCommandCatalog | null;
  slashCommands: AgentSlashCommand[];
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
  skillCatalog: AgentSkillCatalog | null;
  skills: AgentSkillReference[];
  skillsError: string | null;
  isSkillsLoading: boolean;
  subagentCatalog: AgentSubagentCatalog | null;
  subagents: AgentSubagentReference[];
  subagentsError: string | null;
  isSubagentsLoading: boolean;
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
