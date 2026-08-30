import { describe, expect, mock, test } from "bun:test";
import type { GitConflict } from "@/features/agent-studio-git";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { type AgentSessionSummary, toAgentSessionSummary } from "@/state/agent-sessions-store";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import {
  type AgentSessionFixtureOverrides,
  createAgentSessionFixture,
} from "@/test-utils/shared-test-fixtures";
import { createTaskCardFixture } from "../../pages/agents/agent-studio-test-utils";
import { useGitConflictResolution } from "./use-git-conflict-resolution";

const buildSession = (
  overrides: AgentSessionFixtureOverrides & { externalSessionId: string; workingDirectory: string },
): AgentSessionSummary => {
  const { externalSessionId, workingDirectory, ...rest } = overrides;
  return toAgentSessionSummary(
    createAgentSessionFixture(
      {
        externalSessionId: `external-${externalSessionId}`,
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        runtimeKind: "opencode",

        status: "idle",
        runtimeStatusMessage: null,
        startedAt: "2026-03-18T10:00:00.000Z",
        workingDirectory,
        historyLoadState: rest.historyLoadState ?? "not_requested",
        selectedModel: rest.selectedModel ?? null,
      },
      rest,
    ),
  );
};

const sessionIdentity = (
  externalSessionId: string,
  workingDirectory = "/repo/worktrees/task-1",
) => ({
  externalSessionId,
  runtimeKind: "opencode" as const,
  workingDirectory,
});

type GitConflictOverrides = Partial<GitConflict>;

const createConflict = (overrides: GitConflictOverrides = {}) => ({
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
    const startConflictResolutionSession = mock(async () =>
      sessionIdentity("external-build-1", "/repo/worktrees/task-1"),
    );
    const harness = createHookHarness(useGitConflictResolution, {
      workspaceId: "workspace-repo",
      startConflictResolutionSession,
      loadPromptOverrides: async () => ({}),
    });

    try {
      await harness.mount();

      const wrongWorktreeSession = buildSession({
        externalSessionId: "build-other",
        workingDirectory: "/repo/worktrees/other",
      });
      const matchingWorktreeSession = buildSession({
        externalSessionId: "build-1",
        workingDirectory: "/repo/worktrees/task-1",
      });
      const openedSessions: string[] = [];

      const resolved = await harness.getLatest().handleResolveGitConflict(createConflict(), {
        taskId: "task-1",
        task: createTaskCardFixture({ id: "task-1", title: "Resolve rebase conflict" }),
        builderSessions: [wrongWorktreeSession, matchingWorktreeSession],
        currentViewSession: wrongWorktreeSession,
        onOpenSession: (session) => {
          openedSessions.push(session.externalSessionId);
        },
      });

      expect(resolved).toBe(true);
      expect(startConflictResolutionSession).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-1",
          role: "build",
          message: expect.any(String),
          existingSessionOptions: [
            expect.objectContaining({
              value: agentSessionIdentityKey(matchingWorktreeSession),
              sourceSession: {
                externalSessionId: "external-build-1",
                runtimeKind: "opencode",
                workingDirectory: "/repo/worktrees/task-1",
              },
            }),
          ],
          initialStartMode: "reuse",
          initialSourceSession: {
            externalSessionId: "external-build-1",
            runtimeKind: "opencode",
            workingDirectory: "/repo/worktrees/task-1",
          },
        }),
      );
      expect(openedSessions).toEqual(["external-build-1"]);
    } finally {
      await harness.unmount();
    }
  });

  test("allows starting a new conflict-resolution session without an existing selected model", async () => {
    const startConflictResolutionSession = mock(async () => sessionIdentity("build-new"));
    const harness = createHookHarness(useGitConflictResolution, {
      workspaceId: "workspace-repo",
      startConflictResolutionSession,
      loadPromptOverrides: async () => ({}),
    });

    try {
      await harness.mount();

      const resolved = await harness.getLatest().handleResolveGitConflict(createConflict(), {
        taskId: "task-1",
        task: createTaskCardFixture({ id: "task-1", title: "Resolve rebase conflict" }),
        builderSessions: [
          buildSession({
            externalSessionId: "build-1",
            workingDirectory: "/repo/worktrees/task-1",
            selectedModel: null,
          }),
        ],
        currentViewSession: null,
        onOpenSession: () => undefined,
      });

      expect(resolved).toBe(true);
      expect(startConflictResolutionSession).toHaveBeenCalledWith(
        expect.objectContaining({
          initialStartMode: "reuse",
          initialSourceSession: {
            externalSessionId: "external-build-1",
            runtimeKind: "opencode",
            workingDirectory: "/repo/worktrees/task-1",
          },
          targetWorkingDirectory: "/repo/worktrees/task-1",
        }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("passes the conflicted worktree when starting a fresh conflict-resolution session", async () => {
    const startConflictResolutionSession = mock(async () => sessionIdentity("build-new"));
    const harness = createHookHarness(useGitConflictResolution, {
      workspaceId: "workspace-repo",
      startConflictResolutionSession,
      loadPromptOverrides: async () => ({}),
    });

    try {
      await harness.mount();

      const resolved = await harness.getLatest().handleResolveGitConflict(createConflict(), {
        taskId: "task-1",
        task: createTaskCardFixture({ id: "task-1", title: "Resolve rebase conflict" }),
        builderSessions: [],
        currentViewSession: null,
        onOpenSession: () => undefined,
      });

      expect(resolved).toBe(true);
      expect(startConflictResolutionSession).toHaveBeenCalledWith(
        expect.objectContaining({
          initialStartMode: "fresh",
          targetWorkingDirectory: "/repo/worktrees/task-1",
        }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("loads prompt overrides with the workspace id", async () => {
    const startConflictResolutionSession = mock(async () => sessionIdentity("build-new"));
    const loadPromptOverrides = mock(async () => ({}));
    const harness = createHookHarness(useGitConflictResolution, {
      workspaceId: "workspace-repo",
      startConflictResolutionSession,
      loadPromptOverrides,
    });

    try {
      await harness.mount();

      const resolved = await harness.getLatest().handleResolveGitConflict(createConflict(), {
        taskId: "task-1",
        task: createTaskCardFixture({ id: "task-1", title: "Resolve rebase conflict" }),
        builderSessions: [],
        currentViewSession: null,
        onOpenSession: () => undefined,
      });

      expect(resolved).toBe(true);
      expect(loadPromptOverrides).toHaveBeenCalledWith("workspace-repo");
    } finally {
      await harness.unmount();
    }
  });

  test("fails fast when the conflicted working directory is missing", async () => {
    const startConflictResolutionSession = mock(async () => sessionIdentity("build-new"));
    const harness = createHookHarness(useGitConflictResolution, {
      workspaceId: "workspace-repo",
      startConflictResolutionSession,
      loadPromptOverrides: async () => ({}),
    });

    try {
      await harness.mount();

      await expect(
        harness.getLatest().handleResolveGitConflict(createConflict({ workingDir: null }), {
          taskId: "task-1",
          task: createTaskCardFixture({ id: "task-1", title: "Resolve rebase conflict" }),
          builderSessions: [],
          currentViewSession: null,
          onOpenSession: () => undefined,
        }),
      ).rejects.toThrow(
        'Cannot resolve a git conflict for task "task-1" because the conflicted working directory is missing.',
      );

      expect(startConflictResolutionSession).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });
});
