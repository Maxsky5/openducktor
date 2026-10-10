import type { AgentRole, AgentSessionScope } from "@openducktor/core";
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

const createClaudePermissionTestSessionForScope = (
  sessionScope: AgentSessionScope,
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
    sessionScope,
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
    sessionAssociation: sessionScope,
    startedAt: "2026-06-25T12:00:00.000Z",
    status: "idle",
  },
  streamAssistantMessageOrdinal: 0,
  streamAssistantMessageIdsByBlockIndex: new Map(),
  subagentMessageIdsByTaskId: new Map(),
  subagentTaskIdsByToolUseId: new Map(),
  toolEndedAtMsByCallId: new Map(),
  toolInputsByCallId: new Map(),
  toolMessageIdsByCallId: new Map(),
  toolNamesByCallId: new Map(),
  toolStartedAtMsByCallId: new Map(),
  todosById: new Map(),
});

export const createClaudePermissionTestSession = (role: AgentRole = "spec"): ClaudeSessionContext =>
  createClaudePermissionTestSessionForScope({ kind: "workflow", taskId: "task-1", role });

export const createClaudeRepositoryPermissionTestSession = (): ClaudeSessionContext =>
  createClaudePermissionTestSessionForScope({ kind: "repository" });
