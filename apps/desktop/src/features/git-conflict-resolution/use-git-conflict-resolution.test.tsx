import { describe, expect, mock, test } from "bun:test";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createTaskCardFixture } from "../../pages/agents/agent-studio-test-utils";
import { BUILD_REBASE_CONFLICT_RESOLUTION_SCENARIO } from "./constants";
import { useGitConflictResolution } from "./use-git-conflict-resolution";

const buildSession = (
  overrides: Partial<AgentSessionState> & { sessionId: string; workingDirectory: string },
): AgentSessionState => {
  const { sessionId, workingDirectory, ...rest } = overrides;
  return {
  ...rest,
  sessionId,
  externalSessionId: `external-${sessionId}`,
  taskId: "task-1",
  runtimeKind: "opencode",
  role: "build",
  scenario: "build_implementation_start",
  status: "idle",
  startedAt: "2026-03-18T10:00:00.000Z",
  runtimeId: null,
  runId: null,
  runtimeEndpoint: "http://127.0.0.1:4444",
  workingDirectory,
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  contextUsage: null,
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: rest.selectedModel ?? null,
  isLoadingModelCatalog: false,
  };
};

const createConflict = (overrides: Record<string, unknown> = {}) => ({
  operation: "rebase" as const,
  currentBranch: "feature/task-1",
  targetBranch: "origin/main",
  conflictedFiles: ["src/conflict.ts"],
  output: "CONFLICT (content): Merge conflict in src/conflict.ts",
  workingDir: "/repo/worktrees/task-1",
  ...overrides,
});

describe("useGitConflictResolution", () => {
  test("filters reusable Builder sessions to the conflicted worktree", async () => {
    const startConflictResolutionSession = mock(async () => "build-1");
    const harness = createHookHarness(useGitConflictResolution, {
      activeRepo: "/repo",
      startConflictResolutionSession,
      loadPromptOverrides: async () => ({}),
    });

    try {
      await harness.mount();

      const wrongWorktreeSession = buildSession({
        sessionId: "build-other",
        workingDirectory: "/repo/worktrees/other",
      });
      const matchingWorktreeSession = buildSession({
        sessionId: "build-1",
        workingDirectory: "/repo/worktrees/task-1",
      });
      const openedSessions: string[] = [];

      const resolved = await harness
        .getLatest()
        .handleResolveGitConflict(createConflict(), {
          taskId: "task-1",
          task: createTaskCardFixture({ id: "task-1", title: "Resolve rebase conflict" }),
          builderSessions: [wrongWorktreeSession, matchingWorktreeSession],
          currentViewSessionId: "build-other",
          onOpenSession: (sessionId) => {
            openedSessions.push(sessionId);
          },
        });

      expect(resolved).toBe(true);
      expect(startConflictResolutionSession).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-1",
          role: "build",
          scenario: BUILD_REBASE_CONFLICT_RESOLUTION_SCENARIO,
          message: expect.any(String),
          existingSessionOptions: [
            expect.objectContaining({
              value: "build-1",
            }),
          ],
          initialStartMode: "reuse",
          initialSourceSessionId: "build-1",
        }),
      );
      expect(openedSessions).toEqual(["build-1"]);
    } finally {
      await harness.unmount();
    }
  });

  test("allows starting a new conflict-resolution session without an existing selected model", async () => {
    const startConflictResolutionSession = mock(async () => "build-new");
    const harness = createHookHarness(useGitConflictResolution, {
      activeRepo: "/repo",
      startConflictResolutionSession,
      loadPromptOverrides: async () => ({}),
    });

    try {
      await harness.mount();

      const resolved = await harness
        .getLatest()
        .handleResolveGitConflict(createConflict({ workingDir: undefined }), {
          taskId: "task-1",
          task: createTaskCardFixture({ id: "task-1", title: "Resolve rebase conflict" }),
          builderSessions: [
            buildSession({
              sessionId: "build-1",
              workingDirectory: "/repo/worktrees/task-1",
              selectedModel: null,
            }),
          ],
          currentViewSessionId: null,
          onOpenSession: () => undefined,
        });

      expect(resolved).toBe(true);
      expect(startConflictResolutionSession).toHaveBeenCalledWith(
        expect.objectContaining({
          initialStartMode: "reuse",
          initialSourceSessionId: "build-1",
          scenario: BUILD_REBASE_CONFLICT_RESOLUTION_SCENARIO,
        }),
      );
    } finally {
      await harness.unmount();
    }
  });
});
