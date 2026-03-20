import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import type { RefObject } from "react";
import type {
  AgentChatComposerModel,
  AgentChatModel,
  AgentChatThreadModel,
  AgentRoleOption,
  AgentStudioHeaderModel,
  AgentStudioTaskTabsModel,
  AgentStudioWorkspaceDocument,
  AgentStudioWorkspaceSidebarModel,
} from "@/components/features/agents";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import { AGENT_ROLE_LABELS } from "@/types";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentWorkflowStepState } from "@/types/agent-workflow";
import type { SessionCreateOption } from "./agents-page-session-tabs";

export const buildRoleLabelByRole = (roleOptions: AgentRoleOption[]): Record<AgentRole, string> => {
  return roleOptions.reduce(
    (acc, entry) => {
      acc[entry.role] = entry.label;
      return acc;
    },
    { ...AGENT_ROLE_LABELS },
  );
};

export const buildAgentStudioTaskTabsModel = (args: {
  taskTabs: AgentStudioTaskTabsModel["tabs"];
  availableTabTasks: TaskCard[];
  isLoadingTasks: boolean;
  onCreateTab: (taskId: string) => void;
  onCloseTab: (taskId: string) => void;
  agentStudioReady: boolean;
}): AgentStudioTaskTabsModel => ({
  tabs: args.taskTabs,
  availableTabTasks: args.availableTabTasks,
  isLoadingAvailableTabTasks: args.isLoadingTasks,
  onCreateTab: args.onCreateTab,
  onCloseTab: args.onCloseTab,
  agentStudioReady: args.agentStudioReady,
});

export const buildAgentStudioHeaderModel = (args: {
  selectedTask: TaskCard | null;
  onOpenTaskDetails: (() => void) | null;
  activeSession: AgentSessionState | null;
  roleOptions: AgentRoleOption[];
  workflowStateByRole: Record<AgentRole, AgentWorkflowStepState>;
  selectedRole: AgentRole | null;
  workflowSessionByRole: Record<AgentRole, AgentSessionState | null>;
  onWorkflowStepSelect: (role: AgentRole, sessionId: string | null) => void;
  onSessionSelectionChange: (value: string) => void;
  sessionSelectorValue: string;
  sessionSelectorGroups: ComboboxGroup[];
  agentStudioReady: boolean;
  sessionsForTaskLength: number;
  sessionCreateOptions: SessionCreateOption[];
  onCreateSession: (option: SessionCreateOption) => void;
  createSessionDisabled: boolean;
  isStarting: boolean;
  contextSessionsLength: number;
}): AgentStudioHeaderModel => ({
  taskTitle: args.selectedTask?.title ?? null,
  taskId: args.selectedTask?.id ?? null,
  onOpenTaskDetails: args.selectedTask ? args.onOpenTaskDetails : null,
  sessionStatus: args.activeSession?.status ?? null,
  selectedRole: args.selectedRole,
  workflowSteps: args.roleOptions.map((entry) => {
    const workflowSession = args.workflowSessionByRole[entry.role];
    return {
      role: entry.role,
      label: entry.label,
      icon: entry.icon,
      state: args.workflowStateByRole[entry.role],
      sessionId: workflowSession?.sessionId ?? null,
    };
  }),
  onWorkflowStepSelect: args.onWorkflowStepSelect,
  sessionSelector: {
    value: args.sessionSelectorValue,
    groups: args.sessionSelectorGroups,
    disabled: !args.agentStudioReady || args.sessionsForTaskLength === 0,
    onValueChange: args.onSessionSelectionChange,
  },
  sessionCreateOptions: args.sessionCreateOptions,
  onCreateSession: args.onCreateSession,
  createSessionDisabled: args.createSessionDisabled,
  isCreatingSession: args.isStarting,
  stats: {
    sessions: args.contextSessionsLength,
    messages: args.activeSession?.messages.length ?? 0,
    permissions: args.activeSession?.pendingPermissions.length ?? 0,
    questions: args.activeSession?.pendingQuestions.length ?? 0,
  },
  agentStudioReady: args.agentStudioReady,
});

export const buildAgentStudioWorkspaceSidebarModel = (args: {
  activeDocument: AgentStudioWorkspaceDocument | null;
}): AgentStudioWorkspaceSidebarModel => ({
  activeDocument: args.activeDocument,
});

type AgentChatThreadModelArgs = {
  activeSession: AgentSessionState | null;
  showThinkingMessages: boolean;
  isSessionViewLoading: boolean;
  roleOptions: AgentRoleOption[];
  agentStudioReady: boolean;
  agentStudioBlockedReason: string | null;
  isLoadingChecks: boolean;
  onRefreshChecks: () => void;
  taskId: string;
  canKickoffNewSession: boolean;
  kickoffLabel: string;
  onKickoff: () => void;
  isStarting: boolean;
  isSending: boolean;
  activeSessionAgentColors: Record<string, string>;
  isSubmittingQuestionByRequestId: Record<string, boolean>;
  onSubmitQuestionAnswers: (requestId: string, answers: string[][]) => Promise<void>;
  isSubmittingPermissionByRequestId: Record<string, boolean>;
  permissionReplyErrorByRequestId: Record<string, string>;
  onReplyPermission: (requestId: string, reply: "once" | "always" | "reject") => Promise<void>;
  todoPanelCollapsed: boolean;
  onToggleTodoPanel: () => void;
  todoPanelBottomOffset: number;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
};

type AgentChatComposerModelArgs = {
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
  activeSessionAgentColors?: Record<string, string>;
  contextUsage: AgentChatModel["composer"]["contextUsage"];
  canStopSession: boolean;
  onStopSession: () => void;
  composerFormRef: RefObject<HTMLFormElement | null>;
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>;
  onComposerTextareaInput: () => void;
};

export const buildAgentChatThreadModel = (
  args: AgentChatThreadModelArgs,
): AgentChatThreadModel => ({
  session: args.activeSession,
  showThinkingMessages: args.showThinkingMessages,
  isSessionViewLoading: args.isSessionViewLoading,
  roleOptions: args.roleOptions,
  agentStudioReady: args.agentStudioReady,
  blockedReason: args.agentStudioBlockedReason,
  isLoadingChecks: args.isLoadingChecks,
  onRefreshChecks: args.onRefreshChecks,
  taskSelected: Boolean(args.taskId),
  canKickoffNewSession: args.canKickoffNewSession,
  kickoffLabel: args.kickoffLabel,
  onKickoff: args.onKickoff,
  isStarting: args.isStarting,
  isSending: args.isSending,
  sessionAgentColors: args.activeSessionAgentColors,
  isSubmittingQuestionByRequestId: args.isSubmittingQuestionByRequestId,
  onSubmitQuestionAnswers: args.onSubmitQuestionAnswers,
  isSubmittingPermissionByRequestId: args.isSubmittingPermissionByRequestId,
  permissionReplyErrorByRequestId: args.permissionReplyErrorByRequestId,
  onReplyPermission: args.onReplyPermission,
  todoPanelCollapsed: args.todoPanelCollapsed,
  onToggleTodoPanel: args.onToggleTodoPanel,
  todoPanelBottomOffset: args.todoPanelBottomOffset,
  messagesContainerRef: args.messagesContainerRef,
});

export const buildAgentChatComposerModel = (
  args: AgentChatComposerModelArgs,
): AgentChatComposerModel => ({
  taskId: args.taskId,
  agentStudioReady: args.agentStudioReady,
  isReadOnly: args.isReadOnly,
  readOnlyReason: args.readOnlyReason,
  input: args.input,
  onInputChange: args.onInputChange,
  onSend: args.onSend,
  isSending: args.isSending,
  isStarting: args.isStarting,
  isSessionWorking: args.isSessionWorking,
  isWaitingInput: args.isWaitingInput,
  waitingInputPlaceholder: args.waitingInputPlaceholder ?? null,
  isModelSelectionPending: args.isModelSelectionPending,
  selectedModelSelection: args.selectedModelSelection,
  isSelectionCatalogLoading: args.isSelectionCatalogLoading,
  agentOptions: args.agentOptions,
  modelOptions: args.modelOptions,
  modelGroups: args.modelGroups,
  variantOptions: args.variantOptions,
  onSelectAgent: args.onSelectAgent,
  onSelectModel: args.onSelectModel,
  onSelectVariant: args.onSelectVariant,
  ...(args.activeSessionAgentColors ? { sessionAgentColors: args.activeSessionAgentColors } : {}),
  contextUsage: args.contextUsage,
  canStopSession: args.canStopSession,
  onStopSession: args.onStopSession,
  composerFormRef: args.composerFormRef,
  composerTextareaRef: args.composerTextareaRef,
  onComposerTextareaInput: args.onComposerTextareaInput,
});

export const buildAgentChatModel = (
  args: AgentChatThreadModelArgs & AgentChatComposerModelArgs,
): AgentChatModel => ({
  thread: buildAgentChatThreadModel(args),
  composer: buildAgentChatComposerModel(args),
});
