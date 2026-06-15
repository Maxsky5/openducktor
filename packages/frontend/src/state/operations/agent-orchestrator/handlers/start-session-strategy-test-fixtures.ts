import type { TaskWorktreeSummary } from "@openducktor/contracts";
import { createSessionStartGate } from "@/features/session-start/session-start-gate";
import {
  type AgentSessionCollection,
  emptyAgentSessionCollection,
  getAgentSession,
} from "@/state/agent-session-collection";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import type {
  RuntimeDependencies,
  SessionDependencies,
  StartSessionContext,
  TaskDependencies,
} from "./start-session.types";

export const createBuildContinuationTargetFixture = (
  workingDirectory: string,
): TaskWorktreeSummary => ({
  workingDirectory,
});

export const createStartSessionContextFixture = (
  overrides: Partial<StartSessionContext> = {},
): StartSessionContext => ({
  repoPath: "/tmp/repo",
  workspaceId: "workspace-1",
  taskId: "task-1",
  role: "build",
  isStaleRepoOperation: () => false,
  ...overrides,
});

export const createSessionDependenciesFixture = (
  overrides: Partial<SessionDependencies> & {
    sessionsRef?: { current: AgentSessionCollection };
  } = {},
): SessionDependencies => {
  const { sessionsRef: overrideSessionsRef, ...sessionOverrides } = overrides;
  const sessionsRef = overrideSessionsRef ?? { current: emptyAgentSessionCollection() };
  return {
    setSessionCollection: () => {},
    readSessionSnapshot: (identity) => getAgentSession(sessionsRef.current, identity),
    sessionStartGateRef: { current: createSessionStartGate() },
    loadAgentSessions: async () => {},
    loadAgentSessionHistory: async () => {},
    persistSessionRecord: async () => {},
    observeAgentSession: async () => {},
    ...sessionOverrides,
  };
};

export const createRuntimeDependenciesFixture = (
  overrides: Partial<RuntimeDependencies> = {},
): RuntimeDependencies => ({
  adapter: {} as RuntimeDependencies["adapter"],
  ensureRuntime: async () => {
    throw new Error("should not resolve runtime");
  },
  resolveTaskWorktree: async () => createBuildContinuationTargetFixture("/tmp/repo/worktree"),
  ...overrides,
});

export const createTaskDependenciesFixture = (
  overrides: Partial<TaskDependencies> = {},
): TaskDependencies => ({
  taskRef: { current: [] },
  loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
  refreshTaskData: async () => {},
  sendAgentMessage: async () => {},
  ...overrides,
});

export const createBuildSessionFixture = (overrides = {}) =>
  createAgentSessionFixture(
    {
      externalSessionId: "ext-build",
      taskId: "task-1",
      role: "build",
      status: "idle",
      startedAt: "2026-02-22T08:20:00.000Z",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
      selectedModel: null,
    },
    overrides,
  );
