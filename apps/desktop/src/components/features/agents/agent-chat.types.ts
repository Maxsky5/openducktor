import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import type { AgentQuestionRequest, AgentSessionState } from "@/types/agent-orchestrator";
import type { TaskCard } from "@openblueprint/contracts";
import type { AgentModelSelection, AgentRole, AgentScenario } from "@openblueprint/core";
import type { LucideIcon } from "lucide-react";
import type { RefObject, UIEvent } from "react";

export type AgentRoleOption = {
  role: AgentRole;
  label: string;
  icon: LucideIcon;
};

export type AgentChatHeaderModel = {
  sessionStatus: AgentSessionState["status"] | null;
  taskId: string;
  tasks: TaskCard[];
  onTaskChange: (taskId: string) => void;
  selectedTaskTitle: string | null;
  roleOptions: AgentRoleOption[];
  role: AgentRole;
  onRoleChange: (role: AgentRole) => void;
  sessionOptions: ComboboxOption[];
  selectedSessionValue: string;
  onSessionChange: (sessionId: string) => void;
  scenario: AgentScenario;
  scenarioOptions: ComboboxOption[];
  scenarioDisabled: boolean;
  onScenarioChange: (scenario: string) => void;
  canKickoffNewSession: boolean;
  kickoffLabel: string;
  onKickoff: () => void;
  isStarting: boolean;
  isSending: boolean;
  showFollowLatest: boolean;
  onFollowLatest: () => void;
  stats: {
    sessions: number;
    messages: number;
    permissions: number;
    questions: number;
  };
  agentStudioReady: boolean;
};

export type AgentChatThreadModel = {
  session: AgentSessionState | null;
  roleOptions: AgentRoleOption[];
  agentStudioReady: boolean;
  blockedReason: string;
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
  todoPanelCollapsed: boolean;
  onToggleTodoPanel: () => void;
  todoPanelBottomOffset: number;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  onMessagesScroll: (event: UIEvent<HTMLDivElement>) => void;
};

export type AgentChatComposerModel = {
  taskId: string;
  agentStudioReady: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  isSending: boolean;
  isStarting: boolean;
  isSessionWorking: boolean;
  selectedModelSelection: AgentModelSelection | null;
  isSelectionCatalogLoading: boolean;
  agentOptions: ComboboxOption[];
  modelOptions: ComboboxOption[];
  modelGroups: ComboboxGroup[];
  variantOptions: ComboboxOption[];
  onSelectAgent: (agent: string) => void;
  onSelectModel: (model: string) => void;
  onSelectVariant: (variant: string) => void;
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
};

export type AgentChatModel = {
  header: AgentChatHeaderModel;
  thread: AgentChatThreadModel;
  composer: AgentChatComposerModel;
};
