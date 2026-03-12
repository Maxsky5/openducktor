import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import type { RefObject, UIEvent } from "react";
import type { AgentChatModel } from "@/components/features/agents";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { WorkflowModelContext } from "./use-agent-studio-page-model-builders";

export type WorkflowHeaderContext = Pick<
  WorkflowModelContext,
  | "workflowStateByRole"
  | "selectedInteractionRole"
  | "latestSessionByRole"
  | "sessionSelectorValue"
  | "sessionSelectorGroups"
  | "sessionCreateOptions"
  | "createSessionDisabled"
>;

export type WorkflowComposerContext = Pick<
  WorkflowModelContext,
  "selectedRoleAvailable" | "selectedRoleReadOnlyReason"
>;

export type AgentStudioThreadSessionContext = {
  threadSession: AgentSessionState | null;
  isContextSwitching: boolean;
  taskId: string;
  activeSessionAgentColors: Record<string, string>;
};

export type AgentStudioThreadReadinessContext = {
  agentStudioReady: boolean;
  agentStudioBlockedReason: string;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
};

export type AgentStudioThreadKickoffContext = {
  canKickoffNewSession: boolean;
  selectedRoleAvailable: boolean;
  kickoffLabel: string;
  startScenarioKickoff: () => Promise<void>;
  isStarting: boolean;
  isSending: boolean;
};

export type AgentStudioThreadQuestionsContext = {
  isSubmittingQuestionByRequestId: Record<string, boolean>;
  onSubmitQuestionAnswers: (requestId: string, answers: string[][]) => Promise<void>;
};

export type AgentStudioThreadPermissionsContext = {
  isSubmittingPermissionByRequestId: Record<string, boolean>;
  permissionReplyErrorByRequestId: Record<string, string>;
  onReplyPermission: (requestId: string, reply: "once" | "always" | "reject") => Promise<void>;
};

export type AgentStudioThreadTodoPanelContext = {
  todoPanelCollapsed: boolean;
  onToggleTodoPanel: () => void;
  todoPanelBottomOffset: number;
};

export type AgentStudioThreadScrollContext = {
  isPinnedToBottom: boolean;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  onMessagesScroll: (event: UIEvent<HTMLDivElement>) => void;
};

export type AgentStudioComposerSessionContext = {
  taskId: string;
  activeSession: AgentSessionState | null;
  isSessionWorking: boolean;
  canStopSession: boolean;
  stopAgentSession: (sessionId: string) => Promise<void>;
};

export type AgentStudioComposerReadinessContext = {
  agentStudioReady: boolean;
  workflow: WorkflowComposerContext;
};

export type AgentStudioComposerInteractionContext = {
  input: string;
  setInput: (value: string) => void;
  onSend: () => Promise<void>;
  isSending: boolean;
  isStarting: boolean;
  chatContextUsage: AgentChatModel["composer"]["contextUsage"];
};

export type AgentStudioComposerSelectionContext = {
  selectedModelSelection: AgentModelSelection | null;
  isSelectionCatalogLoading: boolean;
  agentOptions: ComboboxOption[];
  modelOptions: ComboboxOption[];
  modelGroups: ComboboxGroup[];
  variantOptions: ComboboxOption[];
  onSelectAgent: (agent: string) => void;
  onSelectModel: (model: string) => void;
  onSelectVariant: (variant: string) => void;
  activeSessionAgentColors: Record<string, string>;
};

export type AgentStudioComposerLayoutContext = {
  composerFormRef: RefObject<HTMLFormElement | null>;
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>;
  resizeComposerTextarea: () => void;
};

export type AgentStudioWorkflowStepSelect = (role: AgentRole, sessionId: string | null) => void;
