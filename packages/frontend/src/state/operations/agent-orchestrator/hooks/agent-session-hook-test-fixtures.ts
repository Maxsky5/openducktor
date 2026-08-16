import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { createSessionMessagesFixture } from "@/test-utils/session-message-test-helpers";
import {
  type AgentSessionFixtureOverrides,
  createAgentSessionFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export const createTaskFixture = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  id: "task-1",
  title: "Task",
  description: "",
  status: "open",
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
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-03-01T09:00:00.000Z",
  createdAt: "2026-03-01T09:00:00.000Z",
  ...overrides,
});

export const createTaskWithSession = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  ...createTaskFixture(),
  ...overrides,
});

type CreateSessionOverrides = AgentSessionFixtureOverrides;

export const createSession = (overrides: CreateSessionOverrides = {}): AgentSessionState => {
  return createAgentSessionFixture(
    {
      runtimeKind: "opencode",
      externalSessionId: "external-1",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },

      status: "idle",
      runtimeStatusMessage: null,
      startedAt: "2026-03-01T09:00:00.000Z",
      workingDirectory: "/tmp/repo/worktree",
      messages: createSessionMessagesFixture("external-1"),
      pendingApprovals: [],
      pendingQuestions: [],
      selectedModel: null,
      historyLoadState: "not_requested",
    },
    overrides,
  );
};

export const createNoopEngine = (overrides: Partial<AgentEnginePort> = {}): AgentEnginePort =>
  ({
    listRuntimeDefinitions: () => [],
    ...overrides,
  }) as AgentEnginePort;
