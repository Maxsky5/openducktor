import type { TaskWorktreeSummary } from "@openducktor/contracts";
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
  overrides: Partial<SessionDependencies> = {},
): SessionDependencies => ({
  setSessionsById: () => {},
  sessionsRef: { current: {} },
  inFlightStartsByWorkspaceTaskRef: { current: new Map() },
  loadAgentSessions: async () => {},
  persistSessionRecord: async () => {},
  attachSessionListener: () => {},
  ...overrides,
});

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
      sessionId: "existing-build",
      externalSessionId: "ext-build",
      taskId: "task-1",
      role: "build",
      scenario: "build_after_human_request_changes",
      status: "idle",
      startedAt: "2026-02-22T08:20:00.000Z",
      runtimeKind: "opencode",
      runtimeId: null,
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
      workingDirectory: "/tmp/repo/worktree",
      selectedModel: null,
      promptOverrides: {},
      isLoadingModelCatalog: false,
    },
    overrides,
  );
