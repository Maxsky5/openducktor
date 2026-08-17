import type { JsonValue } from "@openducktor/contracts";

export const createEventTestSession = (activity: "idle" | "running" = "running") => ({
  acceptedUserMessages: [] as unknown[],
  activeBackgroundSubagentTaskIds: new Set<string>(),
  activeSdkUserTurnCount: 0,
  activity,
  externalSessionId: "session-1",
  pendingApprovals: new Map<string, unknown>(),
  pendingQuestions: new Map<string, unknown>(),
  sdkState: undefined as "idle" | "requires_action" | "running" | undefined,
  pendingUserTurnCount: 0,
  queuedSdkMessages: [],
  streamAssistantMessageOrdinal: 0,
  streamAssistantMessageIdsByBlockIndex: new Map<number, string>(),
  todosById: new Map(),
  subagentMessageIdsByTaskId: new Map<string, string>(),
  subagentTaskIdsByToolUseId: new Map<string, string>(),
  toolInputsByCallId: new Map<string, Record<string, JsonValue>>(),
  toolMessageIdsByCallId: new Map<string, string>(),
  toolNamesByCallId: new Map<string, string>(),
  toolStartedAtMsByCallId: new Map<string, number>(),
});
