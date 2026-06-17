import type { TaskCard } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelSelection,
  AgentSessionTodoItem,
} from "@openducktor/core";
import { Bot, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import { createSessionMessagesFixture } from "@/test-utils/session-message-test-helpers";
import { TEST_EXTERNAL_SESSION_IDS } from "@/test-utils/shared-test-fixtures";
import { AGENT_ROLE_LABELS } from "@/types";
import type {
  AgentApprovalRequest,
  AgentChatMessage,
  AgentQuestionRequest,
  AgentSessionState,
  SessionMessagesState,
} from "@/types/agent-orchestrator";
import type {
  AgentChatThreadModel,
  AgentChatThreadSession,
  AgentRoleOption,
} from "./agent-chat.types";
import { createTextSegment } from "./agent-chat-composer-draft";
import { toAgentChatThreadSession } from "./agent-chat-thread-session";
import { projectAgentChatThreadState } from "./agent-chat-thread-state";

const baseTask: TaskCard = {
  id: "task-1",
  title: "Add social login",
  description: "",
  status: "open",
  priority: 2,
  issueType: "epic",
  aiReviewEnabled: true,
  availableActions: ["set_spec"],
  labels: [],
  parentId: undefined,
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: true, canSkip: false, available: true, completed: false },
    planner: { required: true, canSkip: false, available: false, completed: false },
    builder: { required: true, canSkip: false, available: false, completed: false },
    qa: { required: true, canSkip: false, available: false, completed: false },
  },
  createdAt: "2026-02-20T10:00:00.000Z",
  updatedAt: "2026-02-20T10:00:00.000Z",
};

const baseSelection: AgentModelSelection = {
  runtimeKind: "opencode",
  providerId: "openai",
  modelId: "gpt-5.3-codex",
  variant: "high",
  profileId: "Hephaestus (Deep Agent)",
};

const baseMessage: AgentChatMessage = {
  id: "msg-1",
  role: "assistant",
  content: "Initial response",
  timestamp: "2026-02-20T10:01:00.000Z",
  meta: {
    kind: "assistant",
    agentRole: "spec",
    isFinal: true,
    providerId: "openai",
    modelId: "gpt-5.3-codex",
    profileId: "Hephaestus (Deep Agent)",
    durationMs: 1_200,
  },
};

const baseSession: AgentSessionState = {
  externalSessionId: TEST_EXTERNAL_SESSION_IDS.chatDefault,
  taskId: "task-1",
  runtimeKind: "opencode",
  role: "spec",
  status: "running",
  startedAt: "2026-02-20T10:00:30.000Z",
  workingDirectory: "/repo",
  historyLoadState: "not_requested",
  messages: createSessionMessagesState(TEST_EXTERNAL_SESSION_IDS.chatDefault, [baseMessage]),
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: baseSelection,
};

export const TEST_ROLE_OPTIONS: AgentRoleOption[] = [
  { role: "spec", label: AGENT_ROLE_LABELS.spec, icon: Sparkles },
  { role: "planner", label: AGENT_ROLE_LABELS.planner, icon: Bot },
  { role: "build", label: AGENT_ROLE_LABELS.build, icon: Wrench },
  { role: "qa", label: AGENT_ROLE_LABELS.qa, icon: ShieldCheck },
];

export const buildTask = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  ...baseTask,
  ...overrides,
});

type AgentChatThreadSessionOverrides = Partial<Omit<AgentSessionState, "messages">> & {
  messages?: SessionMessagesState | AgentChatMessage[];
  todos?: AgentChatThreadSession["todos"];
};

export const buildSession = (
  overrides: AgentChatThreadSessionOverrides = {},
): AgentChatThreadSession => {
  const { todos = [], ...overrideSession } = overrides;
  const { messages: overrideMessages, ...overrideSessionFields } = overrideSession;
  const session = {
    ...baseSession,
    ...overrideSessionFields,
  };
  const sourceMessages = overrideMessages ?? baseSession.messages;
  const messages = createSessionMessagesFixture(session.externalSessionId, sourceMessages);

  return toAgentChatThreadSession(
    {
      ...session,
      messages,
    },
    todos,
  );
};

type TranscriptStateFixtureInput =
  | AgentSessionTranscriptState
  | { kind: "failed"; message?: string };

export const buildThreadTranscriptState = (
  transcriptState: TranscriptStateFixtureInput = { kind: "visible" },
): AgentSessionTranscriptState =>
  transcriptState.kind === "failed"
    ? {
        kind: "failed",
        message: transcriptState.message ?? "The selected conversation could not be loaded.",
      }
    : transcriptState;

type AgentChatThreadProjectionFields =
  | "displayedSessionKey"
  | "shouldResetTranscriptWindow"
  | "transcriptNotice";

export type AgentChatThreadModelInput = Omit<
  AgentChatThreadModel,
  AgentChatThreadProjectionFields
> &
  Partial<Pick<AgentChatThreadModel, AgentChatThreadProjectionFields>>;

export const completeThreadModel = (model: AgentChatThreadModelInput): AgentChatThreadModel => {
  const threadState = projectAgentChatThreadState({
    sessionKey:
      model.displayedSessionKey ?? (model.session ? agentSessionIdentityKey(model.session) : null),
    session: model.session,
    transcriptState: model.transcriptState,
    runtimeReadiness: model.runtimeReadiness,
  });

  return {
    ...model,
    session: threadState.threadSession,
    displayedSessionKey: threadState.displayedSessionKey,
    shouldResetTranscriptWindow: threadState.shouldResetTranscriptWindow,
    transcriptNotice: threadState.transcriptNotice,
  };
};

export const buildMessage = (
  role: AgentChatMessage["role"],
  content: string,
  overrides: Partial<AgentChatMessage> = {},
): AgentChatMessage => ({
  ...baseMessage,
  role,
  content,
  ...overrides,
});

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

export const buildQuestionRequest = (
  overrides: Partial<AgentQuestionRequest> = {},
): AgentQuestionRequest => ({
  requestId: "request-1",
  questions: [
    {
      header: "Next Topic",
      question: "What should I focus on?",
      options: [
        { label: "Frontend", description: "UI and browser work" },
        { label: "Backend", description: "Server and APIs" },
      ],
      multiple: false,
      custom: true,
    },
  ],
  ...overrides,
});

export const buildApprovalRequest = (
  overrides: Partial<AgentApprovalRequest> = {},
): AgentApprovalRequest => ({
  requestId: "permission-1",
  requestType: "permission_grant" as const,
  title: `Approve permission: ${"shell"}`,
  summary: `Approval request for ${"shell"}.`,
  affectedPaths: ["*"],
  action: { name: "shell" },
  mutation: "read_only" as const,
  supportedReplyOutcomes: ["approve_once" as const, "approve_session" as const, "reject" as const],
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
