import type { AgentModelSelection } from "@openducktor/core";
import { createSessionMessagesState } from "../sessions/agent-orchestrator/support/messages";
import {
  type AgentSessionFixtureOverrides,
  createAgentSessionFixture,
  TEST_EXTERNAL_SESSION_IDS,
} from "./shared-test-fixtures";
import type {
  AgentApprovalRequest,
  AgentChatMessage,
  AgentQuestionRequest,
  AgentSessionState,
} from "../types/agent-orchestrator";
import type { AgentChatTranscriptSession } from "../sessions/transcript/agent-chat-transcript.types";
import { toAgentChatTranscriptSession } from "../sessions/transcript/agent-chat-transcript-session";

/** Transcript fixtures that the transcript, message, and pending input tests share. */
export const baseSelection: AgentModelSelection = {
  runtimeKind: "opencode",
  providerId: "openai",
  modelId: "gpt-5.3-codex",
  variant: "high",
  profileId: "Hephaestus (Deep Agent)",
};

export const baseMessage: AgentChatMessage = {
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
  sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
  runtimeKind: "opencode",
  status: "running",
  runtimeStatusMessage: null,
  startedAt: "2026-02-20T10:00:30.000Z",
  workingDirectory: "/repo",
  livePresence: "unobserved",
  historyLoadState: "not_requested",
  messages: createSessionMessagesState(TEST_EXTERNAL_SESSION_IDS.chatDefault, [baseMessage]),
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: baseSelection,
};

type AgentChatTranscriptSessionOverrides = AgentSessionFixtureOverrides;

export const buildSession = (
  overrides: AgentChatTranscriptSessionOverrides = {},
): AgentChatTranscriptSession => {
  return toAgentChatTranscriptSession(createAgentSessionFixture(baseSession, overrides));
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
