import type { AgentRole } from "@openducktor/core";
import { createClaudeCanUseTool as createClaudeCanUseToolBase } from "./claude-agent-sdk-permissions";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import type { ClaudeSessionContext } from "./claude-agent-sdk-types";

export const createClaudeCanUseTool = (
  input: Parameters<typeof createClaudeCanUseToolBase>[0],
): ReturnType<typeof createClaudeCanUseToolBase> =>
  createClaudeCanUseToolBase({
    canonicalizePath: async (path) => path,
    ...input,
  });

export const createClaudePermissionTestSession = (
  role: AgentRole = "spec",
): ClaudeSessionContext => ({
  acceptedUserMessages: [],
  activeSdkUserTurnCount: 0,
  abortController: new AbortController(),
  activity: "idle",
  externalSessionId: "session-1",
  input: {
    repoPath: "/repo",
    runtimeKind: "claude",
    workingDirectory: "/repo",
    externalSessionId: "session-1",
    runtimePolicy: { kind: "claude" },
    sessionScope: { kind: "workflow", taskId: "task-1", role },
  },
  model: undefined,
  pendingApprovals: new Map(),
  pendingQuestions: new Map(),
  queuedSdkMessages: [],
  pendingUserTurnCount: 0,
  queue: new AsyncInputQueue(),
  runtimeId: "runtime-1",
  startedAt: "2026-06-25T12:00:00.000Z",
  summary: {
    externalSessionId: "session-1",
    runtimeKind: "claude",
    workingDirectory: "/repo",
    role,
    startedAt: "2026-06-25T12:00:00.000Z",
    status: "idle",
  },
  streamAssistantMessageOrdinal: 0,
  streamAssistantMessageIdsByBlockIndex: new Map(),
  subagentMessageIdsByTaskId: new Map(),
  subagentTaskIdsByToolUseId: new Map(),
  toolInputsByCallId: new Map(),
  toolMessageIdsByCallId: new Map(),
  toolNamesByCallId: new Map(),
  toolStartedAtMsByCallId: new Map(),
});
