import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeEventSession } from "./claude-agent-sdk-event-session";
import type { ClaudeLifecycleSession } from "./claude-agent-sdk-lifecycle";
import type {
  ClaudeAcceptedUserMessage,
  ClaudeToolInput,
  PendingApproval,
  PendingQuestion,
} from "./claude-agent-sdk-types";

type EventTestSession = Omit<
  ClaudeEventSession,
  | "acceptedUserMessages"
  | "activeBackgroundSubagentTaskIds"
  | "pendingApprovals"
  | "pendingQuestions"
> &
  ClaudeLifecycleSession & {
    acceptedUserMessages: ClaudeAcceptedUserMessage[];
    activeBackgroundSubagentTaskIds: Set<string>;
    pendingApprovals: Map<string, PendingApproval>;
    pendingQuestions: Map<string, PendingQuestion>;
    queuedSdkMessages: SDKUserMessage[];
  };

export const claudeAcceptedUserMessageFixture = (
  overrides: Partial<ClaudeAcceptedUserMessage> = {},
): ClaudeAcceptedUserMessage => ({
  messageId: "user-message-1",
  parts: [],
  text: "",
  timestamp: "2026-06-25T19:59:00.000Z",
  ...overrides,
});

export const createEventTestSession = (
  activity: "idle" | "running" = "running",
): EventTestSession => ({
  acceptedUserMessages: [],
  activeBackgroundSubagentTaskIds: new Set<string>(),
  activeSdkUserTurnCount: 0,
  activity,
  externalSessionId: "session-1",
  pendingApprovals: new Map<string, PendingApproval>(),
  pendingQuestions: new Map<string, PendingQuestion>(),
  pendingUserTurnCount: 0,
  queuedSdkMessages: [],
  streamAssistantMessageOrdinal: 0,
  streamAssistantMessageIdsByBlockIndex: new Map<number, string>(),
  todosById: new Map(),
  subagentMessageIdsByTaskId: new Map<string, string>(),
  subagentTaskIdsByToolUseId: new Map<string, string>(),
  toolInputsByCallId: new Map<string, ClaudeToolInput>(),
  toolMessageIdsByCallId: new Map<string, string>(),
  toolNamesByCallId: new Map<string, string>(),
  toolStartedAtMsByCallId: new Map<string, number>(),
});
