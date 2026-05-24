import type {
  AgentSessionRecord,
  RuntimeInstanceSummary,
  RuntimeKind,
  TaskCard,
} from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  type AgentEnginePort,
  type LiveAgentSessionSnapshot,
  type LoadAgentSessionHistoryInput,
  toAgentSessionPresenceSnapshotFromLiveSnapshot,
} from "@openducktor/core";
import type { SetStateAction } from "react";
import { getSessionMessageCount } from "@/state/operations/agent-orchestrator/support/messages";
import { sessionMessageAt } from "@/test-utils/session-message-test-helpers";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createAgentSessionPresenceSnapshotFixture } from "../test-utils";
import {
  createHydrationPromptAssemblerStage,
  createRuntimeResolutionPlannerStage,
  type HydrationRuntimePlanner,
  hydrateSessionRecordsStage,
  preparePersistedSessionMergeStage,
  reconcileLiveSessionsStage,
  type SessionLifecycleAdapter,
  type SessionLoadIntent,
  type UpdateSession,
} from "./load-sessions-stages";
import { createStateHarness } from "./load-sessions-state-test-harness";
import { agentSessionPresenceLookupKey } from "./session-presence-cache";

export type SessionStateMap = Record<string, AgentSessionState>;
export type AttachSessionInput = Parameters<AgentEnginePort["attachSession"]>[0];
export type ResumeSessionInput = Parameters<AgentEnginePort["resumeSession"]>[0];
export type ListSessionPresenceInput = Parameters<AgentEnginePort["listSessionPresence"]>[0];
type LiveSnapshotOverrides = Omit<Partial<LiveAgentSessionSnapshot>, "title"> & {
  title?: string | undefined;
};

const createSessionSummary = (input: AttachSessionInput | ResumeSessionInput) => ({
  externalSessionId: input.externalSessionId,
  role: input.role,
  startedAt: "2026-03-01T09:00:00.000Z",
  status: "idle" as const,
  runtimeKind: input.runtimeKind,
});

export const createLifecycleAdapter = (
  overrides: Partial<SessionLifecycleAdapter> = {},
): SessionLifecycleAdapter => ({
  hasSession: () => false,
  listSessionPresence: async () => [],
  loadSessionHistory: async () => [],
  attachSession: async (input) => createSessionSummary(input),
  resumeSession: async (input) => createSessionSummary(input),
  ...overrides,
});

export const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  externalSessionId: "external-1",
  taskId: "task-1",
  repoPath: overrides.repoPath ?? "/tmp/repo",
  role: "build",
  status: "idle",
  startedAt: "2026-03-01T09:00:00.000Z",
  runtimeKind: "opencode",
  runtimeId: null,
  workingDirectory: "/tmp/repo/worktree",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  contextUsage: null,
  pendingApprovals: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
  promptOverrides: {},
  ...overrides,
});

export const createRecord = (overrides: Partial<AgentSessionRecord> = {}): AgentSessionRecord => ({
  externalSessionId: "external-1",
  role: "build",
  startedAt: "2026-03-01T09:00:00.000Z",
  workingDirectory: "/tmp/repo/worktree",
  runtimeKind: "opencode",
  selectedModel: null,
  ...overrides,
});

export const createIntent = (overrides: Partial<SessionLoadIntent> = {}): SessionLoadIntent => ({
  repoPath: "/tmp/repo",
  workspaceId: "workspace-1",
  taskId: "task-1",
  mode: "bootstrap",
  requestedSessionId: null,
  requestedHistoryKey: null,
  shouldHydrateRequestedSession: false,
  shouldReconcileLiveSessions: false,
  historyPolicy: "none",
  ...overrides,
});

export const createSessionPresenceSnapshot = (
  externalSessionId: string,
  workingDirectory: string,
  overrides: LiveSnapshotOverrides = {},
) =>
  createAgentSessionPresenceSnapshotFixture({
    ref: {
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      externalSessionId,
      workingDirectory,
    },
    snapshot: {
      externalSessionId,
      title: "Builder Session",
      startedAt: "2026-03-01T09:00:00.000Z",
      status: { type: "busy" },
      pendingApprovals: [],
      pendingQuestions: [],
      workingDirectory,
      ...overrides,
    } as Partial<LiveAgentSessionSnapshot>,
  });

export const createStalePresence = (externalSessionId: string, workingDirectory: string) =>
  toAgentSessionPresenceSnapshotFromLiveSnapshot({
    ref: {
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      externalSessionId,
      workingDirectory,
    },
    runtimeId: null,
    snapshot: null,
  });

export const createTaskFixture = (): TaskCard => ({
  id: "task-1",
  title: "Refactor loader",
  description: "Split hydration into explicit stages",
  notes: "",
  status: "ready_for_dev",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: false, completed: false },
    planner: { required: false, canSkip: true, available: false, completed: false },
    builder: { required: true, canSkip: false, available: false, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-03-01T09:00:00.000Z",
  createdAt: "2026-03-01T09:00:00.000Z",
});

export const createRuntime = (
  workingDirectory: string,
  runtimeKind: RuntimeKind = "opencode",
): RuntimeInstanceSummary => ({
  kind: runtimeKind,
  runtimeId: "runtime-1",
  repoPath: "/tmp/repo",
  taskId: null,
  role: "workspace",
  workingDirectory,
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4444",
  },
  startedAt: "2026-03-01T09:00:00.000Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
});

export const createStdioRuntime = (
  runtimeId: string,
  workingDirectory: string,
): RuntimeInstanceSummary => ({
  ...createRuntime(workingDirectory),
  runtimeId,
  runtimeRoute: { type: "stdio", identity: runtimeId },
});

export type {
  AgentEnginePort,
  AgentSessionRecord,
  AgentSessionState,
  HydrationRuntimePlanner,
  LiveAgentSessionSnapshot,
  LoadAgentSessionHistoryInput,
  RuntimeInstanceSummary,
  RuntimeKind,
  SessionLifecycleAdapter,
  SessionLoadIntent,
  SetStateAction,
  UpdateSession,
};
export {
  agentSessionPresenceLookupKey,
  createHydrationPromptAssemblerStage,
  createRuntimeResolutionPlannerStage,
  createStateHarness,
  getSessionMessageCount,
  hydrateSessionRecordsStage,
  preparePersistedSessionMergeStage,
  reconcileLiveSessionsStage,
  sessionMessageAt,
};
