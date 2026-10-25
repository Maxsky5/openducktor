import { createSessionMessagesFixture } from "../../../test-support/session-message-test-helpers";
import {
  type AgentSessionFixtureOverrides,
  createAgentSessionFixture,
} from "../../../test-support/shared-test-fixtures";
import type { AgentSessionState } from "../../../types/agent-orchestrator";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

export const createTaskFixture = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  id: "task-1",
  title: "Task",
  description: "",
  status: "open",
  priority: 2,
  issueType: "task",
  availableActions: [],
  labels: [],
  artifactSummary: {
    spec: { present: false },
    plan: { present: false },
    qaReport: { present: false },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    build: { required: true, canSkip: false, available: true, completed: false },
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
