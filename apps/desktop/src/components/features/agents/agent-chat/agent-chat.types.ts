import type { AgentModelSelection, AgentRole } from "@openducktor/core";
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
  roleOptions: AgentRoleOption[];
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
};

export type AgentChatComposerModel = {
  taskId: string;
  agentStudioReady: boolean;
  isReadOnly: boolean;
  readOnlyReason: string | null;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  isSending: boolean;
  isStarting: boolean;
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  waitingInputPlaceholder?: string | null;
  isModelSelectionPending: boolean;
  selectedModelSelection: AgentModelSelection | null;
  isSelectionCatalogLoading: boolean;
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
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>;
  onComposerTextareaInput: () => void;
  scrollToBottomOnSendRef: MutableRefObject<(() => void) | null>;
};

export type AgentChatModel = {
  thread: AgentChatThreadModel;
  composer: AgentChatComposerModel;
};
