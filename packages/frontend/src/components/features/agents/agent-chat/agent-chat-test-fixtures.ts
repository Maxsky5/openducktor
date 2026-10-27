import { BUILTIN_ROLE_LABELS, type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import type {
  AgentFileSearchResult,
  AgentModelSelection,
  AgentSessionTodoItem,
} from "@openducktor/core";
import { createRef } from "react";
import { AGENT_ROLE_ICONS } from "@/lib/agent-role-presentation";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import type { AgentRoleOption } from "../agent-studio-header.types";
import type { AgentChatThreadModel } from "./agent-chat.types";
import type {
  AgentChatTranscriptPresentation,
  AgentChatTranscriptSession,
} from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript.types";
import type { AgentChatToolCallPresentation } from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import { createTextSegment } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { baseSelection } from "@openducktor/frontend-core/test-support/agent-chat-transcript-fixtures";

const baseTask: TaskCard = {
  id: "task-1",
  title: "Add social login",
  description: "",
  status: "open",
  priority: 2,
  issueType: "feature",
  removeWorktreeOnClose: null,
  availableActions: ["set_spec"],
  labels: [],
  artifactSummary: {
    spec: { present: false },
    plan: { present: false },
    qaReport: { present: false },
  },
  agentWorkflows: {
    spec: { required: true, canSkip: false, available: true, completed: false },
    planner: { required: true, canSkip: false, available: false, completed: false },
    build: { required: true, canSkip: false, available: false, completed: false },
    qa: { required: true, canSkip: false, available: false, completed: false },
  },
  createdAt: "2026-02-20T10:00:00.000Z",
  updatedAt: "2026-02-20T10:00:00.000Z",
};

export const TEST_ROLE_OPTIONS: AgentRoleOption[] = [
  { role: "spec", label: BUILTIN_ROLE_LABELS.spec, icon: AGENT_ROLE_ICONS.spec },
  { role: "planner", label: BUILTIN_ROLE_LABELS.planner, icon: AGENT_ROLE_ICONS.planner },
  { role: "build", label: BUILTIN_ROLE_LABELS.build, icon: AGENT_ROLE_ICONS.build },
  { role: "qa", label: BUILTIN_ROLE_LABELS.qa, icon: AGENT_ROLE_ICONS.qa },
];

export const buildTask = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  ...baseTask,
  ...overrides,
});

export const presentRegularToolCall = (
  toolName: string,
  displayLabel?: string,
): AgentChatToolCallPresentation => ({
  kind: "regular",
  displayName: displayLabel?.trim() || toolName,
});

type AgentChatSessionTranscriptOverrides = Partial<
  Pick<AgentChatTranscriptPresentation, "target" | "displayedSessionKey" | "notice">
>;

export const buildSessionTranscript = (
  session: AgentChatTranscriptSession,
  overrides: AgentChatSessionTranscriptOverrides = {},
): AgentChatTranscriptPresentation => ({
  kind: "session",
  session,
  target: overrides.target === undefined ? session : overrides.target,
  repoPath: "/repo",
  displayedSessionKey:
    overrides.displayedSessionKey === undefined
      ? agentSessionIdentityKey(session)
      : overrides.displayedSessionKey,
  shouldResetWindow: false,
  notice: overrides.notice ?? null,
});

type AgentChatEmptyTranscriptOverrides = Partial<
  Pick<
    AgentChatTranscriptPresentation,
    "target" | "displayedSessionKey" | "shouldResetWindow" | "notice"
  >
>;

export const buildEmptyTranscript = (
  overrides: AgentChatEmptyTranscriptOverrides = {},
): AgentChatTranscriptPresentation => ({
  kind: "empty",
  session: null,
  target: overrides.target ?? null,
  repoPath: "/repo",
  displayedSessionKey: overrides.displayedSessionKey ?? null,
  shouldResetWindow: overrides.shouldResetWindow ?? false,
  notice: overrides.notice ?? null,
});

type AgentChatThreadFixtureDefaults =
  | "modelCatalog"
  | "pendingApprovalRequests"
  | "pendingQuestionRequests"
  | "todos"
  | "sessionAccentColor"
  | "runtimePresentation";

export type AgentChatThreadModelInput = Omit<AgentChatThreadModel, AgentChatThreadFixtureDefaults> &
  Partial<Pick<AgentChatThreadModel, AgentChatThreadFixtureDefaults>>;

export const buildBaseModel = () => ({
  isSessionWorking: false,
  isInteractionEnabled: true,
  runtimePresentation: {
    runtimeKind: "opencode" as const,
    presentToolCall: presentRegularToolCall,
    supportedApprovalReplyOutcomes: ["approve_once", "approve_session", "reject"] as const,
  },
  emptyState: {
    title: "Send a message to start a new session automatically.",
  },
  isStarting: false,
  isSending: false,
  canSubmitQuestionAnswers: true,
  isSubmittingQuestionByRequestId: {},
  canReplyToApprovals: true,
  isSubmittingApprovalByRequestId: {},
  approvalReplyErrorByRequestId: {},
  onSubmitQuestionAnswers: async () => {},
  onReplyApproval: async () => {},
  sessionAuxiliaryError: null,
  todoPanelCollapsed: false,
  onToggleTodoPanel: () => {},
  messagesContainerRef: createRef<HTMLDivElement>(),
  scrollToBottomOnSendRef: { current: null } satisfies { current: (() => void) | null },
});

export const completeThreadModel = (model: AgentChatThreadModelInput): AgentChatThreadModel => {
  return {
    ...model,
    modelCatalog: model.modelCatalog ?? null,
    runtimePresentation: model.runtimePresentation ?? buildBaseModel().runtimePresentation,
    pendingApprovalRequests: model.pendingApprovalRequests ?? [],
    pendingQuestionRequests: model.pendingQuestionRequests ?? [],
    todos: model.todos ?? [],
  };
};

export const buildModelSelection = (
  overrides: Partial<AgentModelSelection> = {},
): AgentModelSelection => ({
  ...baseSelection,
  ...overrides,
});

export const createComposerDraft = (text: string) => ({
  segments: [createTextSegment(text)],
  attachments: [],
});

export const buildFileSearchResult = (
  overrides: Partial<AgentFileSearchResult> = {},
): AgentFileSearchResult => ({
  id: "src/main.ts",
  path: "src/main.ts",
  name: "main.ts",
  kind: "code",
  ...overrides,
});

export const buildTodoItem = (
  overrides: Partial<AgentSessionTodoItem> = {},
): AgentSessionTodoItem => ({
  id: "todo-1",
  content: "Analyze current styling",
  status: "in_progress",
  priority: "medium",
  ...overrides,
});
