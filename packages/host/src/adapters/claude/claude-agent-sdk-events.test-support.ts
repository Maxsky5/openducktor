import type { ClaudeEventSession } from "./claude-agent-sdk-event-session";
import type { ClaudeLifecycleSession } from "./claude-agent-sdk-lifecycle";

type EventTestSession = Omit<
  ClaudeEventSession,
  | "acceptedUserMessages"
  | "activeBackgroundSubagentTaskIds"
  | "pendingApprovals"
  | "pendingQuestions"
> &
  ClaudeLifecycleSession & {
    acceptedUserMessages: unknown[];
    activeBackgroundSubagentTaskIds: Set<string>;
    pendingApprovals: Map<string, unknown>;
    pendingQuestions: Map<string, unknown>;
    queuedSdkMessages: unknown[];
  };

export const createEventTestSession = (
  activity: "idle" | "running" = "running",
): EventTestSession => ({
  acceptedUserMessages: [],
  activeBackgroundSubagentTaskIds: new Set<string>(),
  activeSdkUserTurnCount: 0,
  activity,
  externalSessionId: "session-1",
  pendingApprovals: new Map<string, unknown>(),
  pendingQuestions: new Map<string, unknown>(),
  pendingUserTurnCount: 0,
  queuedSdkMessages: [],
  streamAssistantMessageOrdinal: 0,
  streamAssistantMessageIdsByBlockIndex: new Map<number, string>(),
  todosById: new Map(),
  subagentMessageIdsByTaskId: new Map<string, string>(),
  subagentTaskIdsByToolUseId: new Map<string, string>(),
  toolInputsByCallId: new Map<string, Record<string, unknown>>(),
  toolMessageIdsByCallId: new Map<string, string>(),
  toolNamesByCallId: new Map<string, string>(),
  toolStartedAtMsByCallId: new Map<string, number>(),
});
