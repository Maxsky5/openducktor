import type { ReactNode } from "react";
import type { AgentChatForkActions } from "./agent-chat-fork-context";
import type { AgentChatSendResult } from "@openducktor/frontend-core/sessions/send/agent-chat-send-result";
import type {
  AgentMessageSubmitMode,
  ChatSettings,
  RuntimeApprovalReplyOutcome,
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
import type { SpeedControlModel } from "@openducktor/frontend-core/sessions/model-selection/use-speed-control";
import type { ComboboxOption } from "@/components/ui/combobox";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import type { AgentChatComposerDraft } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import type { AgentChatDraftScope } from "@openducktor/frontend-core/sessions/send/agent-chat-draft-scope";
import type {
  AgentChatEmptyStateModel,
  AgentChatRuntimePresentation,
  AgentChatInterruptedTurnResumeModel,
  AgentChatPendingSendGroup,
  AgentChatModelPicker,
  AgentChatMessageQueueModel,
} from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import type { AgentChatTranscriptPresentation } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript.types";

export type AgentChatThreadModel = {
  forkActions?: AgentChatForkActions | null;
  forkDialog?: ReactNode;
  modelCatalog: AgentModelCatalog | null;
  transcript: AgentChatTranscriptPresentation;
  runtimePresentation: AgentChatRuntimePresentation;
  isSessionWorking: boolean;
  isInteractionEnabled: boolean;
  emptyState: AgentChatEmptyStateModel | null;
  isStarting: boolean;
  isSending: boolean;
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
  interruptedTurnResume?: AgentChatInterruptedTurnResumeModel | undefined;
  sessionAuxiliaryError: string | null;
  todoPanelCollapsed: boolean;
  onToggleTodoPanel: () => void;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  scrollToBottomOnSendRef: MutableRefObject<(() => void) | null>;
};

export type AgentChatComposerModel = {
  displayedSessionKey: string | null;
  isInteractionEnabled: boolean;
  isReadOnly: boolean;
  canSend?: boolean;
  readOnlyReason: string | null;
  pendingSendItems?: readonly AgentChatPendingSendGroup[];
  draftScope: AgentChatDraftScope;
  onSend: (
    draft: AgentChatComposerDraft,
    mode: AgentMessageSubmitMode,
  ) => Promise<AgentChatSendResult>;
  isSending: boolean;
  isStarting: boolean;
  isSavingModel?: boolean;
  isSessionWorking: boolean;
  foregroundTurnActive?: boolean | undefined;
  isWaitingInput: boolean;
  waitingInputPlaceholder?: string | null;
  /** Why the session cannot steer the running turn now, or null when it can. */
  steerBlockedReason: string | null;
  runningTurnModel: AgentModelCatalog["models"][number] | null;
  messageQueue: AgentChatMessageQueueModel | null;
  isModelSelectionPending: boolean;
  selectedModelSelection: AgentModelSelection | null;
  /** Null when no speed control is available. */
  speed: SpeedControlModel | null;
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
  retrySlashCommands: (() => void) | null;
  skillCatalog: AgentSkillCatalog | null;
  skills: AgentSkillReference[];
  skillsError: string | null;
  isSkillsLoading: boolean;
  retrySkills: (() => void) | null;
  subagentCatalog: AgentSubagentCatalog | null;
  subagents: AgentSubagentReference[];
  subagentsError: string | null;
  isSubagentsLoading: boolean;
  retrySubagents: (() => void) | null;
  onCatalogMenuOpen: () => void;
  onAgentSelectorOpen: () => void;
  onVariantSelectorOpen: () => void;
  searchFiles: (query: string) => Promise<AgentFileSearchResult[]>;
  agentOptions: ComboboxOption[];
  modelPicker: AgentChatModelPicker;
  variantOptions: ComboboxOption[];
  onSelectAgent: (agent: string) => void;
  onSelectVariant: (variant: string) => void;
  accentColor?: string | undefined;
  contextUsage: {
    totalTokens: number;
    contextWindow: number;
    outputLimit?: number;
  } | null;
  canStopSession: boolean;
  onStopSession: () => void;
  isResumingSession: boolean;
  composerFormRef: RefObject<HTMLFormElement | null>;
  composerEditorRef: RefObject<HTMLDivElement | null>;
  onComposerEditorInput: () => void;
  scrollToBottomOnSendRef: MutableRefObject<(() => void) | null>;
};

export type AgentChatSurfaceModel = {
  chatSettings: ChatSettings | null;
  thread: AgentChatThreadModel;
  composer?: AgentChatComposerModel;
};

export type AgentChatModel = AgentChatSurfaceModel & {
  composer: AgentChatComposerModel;
};
