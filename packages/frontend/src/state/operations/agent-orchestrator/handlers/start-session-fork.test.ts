import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { replaceAgentSession } from "@/state/agent-session-collection";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import {
  BUILD_SELECTION,
  createSessionsRef,
  createStartSessionTestHarness,
  getSession,
  sessionFixture,
  taskFixture,
} from "./start-session.test-helpers";

describe("agent-orchestrator/handlers/start-session fork", () => {
  test("forks from the selected source session for pull request generation", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const originalLoadSessionHistory = adapter.loadSessionHistory;
    const persistedSnapshots: AgentSessionRecord[] = [];
    const sessionsRef = createSessionsRef([
      sessionFixture({
        externalSessionId: "external-source-build",
        startedAt: "2026-02-22T08:10:00.000Z",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          profileId: "builder",
        },
      }),
    ]);

    adapter.forkSession = async (input) => {
      expect(input.taskId).toBe("task-1");
      expect(input.role).toBe("build");
      expect(input.parentExternalSessionId).toBe("external-source-build");
      expect(input.repoPath).toBe("/tmp/repo");
      expect(input.runtimeKind).toBe("opencode");
      expect(input.workingDirectory).toBe("/tmp/repo/worktree");
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "external-forked-pr-session",
        startedAt: "2026-02-22T08:20:00.000Z",
        role: "build",
        status: "idle",
      };
    };
    adapter.loadSessionHistory = async (input) => {
      expect(input.repoPath).toBe("/tmp/repo");
      expect(input.runtimeKind).toBe("opencode");
      expect(input.workingDirectory).toBe("/tmp/repo/worktree");
      expect(input.externalSessionId).toBe("external-forked-pr-session");
      return [
        {
          messageId: "fork-user-1",
          role: "user",
          state: "read",
          timestamp: "2026-02-22T08:21:00.000Z",
          text: "Generate the PR summary.",
          displayParts: [],
          parts: [],
        },
        {
          messageId: "fork-assistant-1",
          role: "assistant",
          timestamp: "2026-02-22T08:22:00.000Z",
          text: "I drafted the summary.",
          parts: [],
        },
      ];
    };

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef,
      taskRef: { current: [taskFixture] },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
      }),
      persistSessionRecord: async (_taskId, record) => {
        persistedSnapshots.push(record);
      },
    });

    try {
      const externalSessionId = await start({
        taskId: "task-1",
        role: "build",
        startMode: "fork",
        selectedModel: BUILD_SELECTION,
        sourceSession: {
          externalSessionId: "external-source-build",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        },
      });

      expect(externalSessionId).toEqual(
        expect.objectContaining({ externalSessionId: "external-forked-pr-session" }),
      );
      expect(getSession(sessionsRef.current, "external-forked-pr-session")?.workingDirectory).toBe(
        "/tmp/repo/worktree",
      );
      const forkedSession = getSession(sessionsRef.current, "external-forked-pr-session");
      expect(forkedSession?.historyLoadState).toBe("loaded");
      const forkedMessages = forkedSession ? sessionMessagesToArray(forkedSession) : [];
      expect(forkedMessages.slice(0, 3)).toEqual([
        {
          id: "history:system-prompt:external-forked-pr-session",
          role: "system",
          content: forkedMessages[0]?.content ?? "",
          timestamp: "2026-02-22T08:20:00.000Z",
        },
        {
          id: "fork-user-1",
          role: "user",
          content: "Generate the PR summary.",
          timestamp: "2026-02-22T08:21:00.000Z",
          meta: {
            kind: "user",
            state: "read",
          },
        },
        {
          id: "fork-assistant-1",
          role: "assistant",
          content: "I drafted the summary.",
          timestamp: "2026-02-22T08:22:00.000Z",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: false,
          },
        },
      ]);
      expect(forkedMessages[0]?.content).toContain("System prompt:");
      expect(persistedSnapshots).toHaveLength(1);
      expect(persistedSnapshots[0]?.externalSessionId).toBe("external-forked-pr-session");
    } finally {
      adapter.forkSession = originalForkSession;
      adapter.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("loads stopped source session history before forking so inherited history is available immediately", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const originalLoadSessionHistory = adapter.loadSessionHistory;
    const loadSourceSessionCalls: string[] = [];
    const loadAgentSessionHistoryCalls: AgentSessionIdentity[] = [];
    const sessionsRef = createSessionsRef([
      sessionFixture({
        externalSessionId: "external-source-build",
        status: "stopped",
        startedAt: "2026-02-22T08:10:00.000Z",
        contextUsage: null,
        selectedModel: BUILD_SELECTION,
      }),
    ]);

    adapter.forkSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "external-forked-from-loaded-source",
      startedAt: "2026-02-22T08:20:00.000Z",
      role: "build",
      status: "idle",
    });
    adapter.loadSessionHistory = async () => [
      {
        messageId: "child-user-1",
        role: "user",
        state: "read",
        timestamp: "2026-02-22T08:21:00.000Z",
        text: "Loaded child history",
        displayParts: [],
        parts: [],
      },
    ];

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef,
      taskRef: { current: [taskFixture] },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadSourceSession: async ({ taskId }) => {
        loadSourceSessionCalls.push(taskId);
        return null;
      },
      loadAgentSessionHistory: async (session) => {
        loadAgentSessionHistoryCalls.push(session);
        const sourceBuild = getSession(sessionsRef.current, "external-source-build");
        if (!sourceBuild) {
          throw new Error("Missing external-source-build session");
        }
        sessionsRef.current = replaceAgentSession(sessionsRef.current, {
          ...sourceBuild,
          historyLoadState: "loaded",
        });
      },
    });

    try {
      const externalSessionId = await start({
        taskId: "task-1",
        role: "build",
        startMode: "fork",
        selectedModel: BUILD_SELECTION,
        sourceSession: {
          externalSessionId: "external-source-build",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        },
      });

      expect(externalSessionId).toEqual(
        expect.objectContaining({ externalSessionId: "external-forked-from-loaded-source" }),
      );
      expect(loadSourceSessionCalls).toEqual([]);
      expect(loadAgentSessionHistoryCalls).toEqual([
        {
          externalSessionId: "external-source-build",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        },
      ]);
      const forkedSession = getSession(sessionsRef.current, "external-forked-from-loaded-source");
      expect(forkedSession?.historyLoadState).toBe("loaded");
      const forkedMessages = forkedSession ? sessionMessagesToArray(forkedSession) : [];
      expect(forkedMessages.slice(0, 2)).toEqual([
        {
          id: "history:system-prompt:external-forked-from-loaded-source",
          role: "system",
          content: forkedMessages[0]?.content ?? "",
          timestamp: "2026-02-22T08:20:00.000Z",
        },
        {
          id: "child-user-1",
          role: "user",
          content: "Loaded child history",
          timestamp: "2026-02-22T08:21:00.000Z",
          meta: {
            kind: "user",
            state: "read",
          },
        },
      ]);
      expect(forkedMessages[0]?.content).toContain("System prompt:");
    } finally {
      adapter.forkSession = originalForkSession;
      adapter.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("forks from a loaded source session without live runtime transport", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const forkCalls: unknown[] = [];
    const sessionsRef = createSessionsRef([
      sessionFixture({
        externalSessionId: "external-source-build",
        startedAt: "2026-02-22T08:10:00.000Z",
        selectedModel: BUILD_SELECTION,
      }),
    ]);

    adapter.forkSession = async (input) => {
      forkCalls.push(input);
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "external-forked-from-runtime-connection",
        startedAt: "2026-02-22T08:20:00.000Z",
        role: "build",
        status: "idle",
      };
    };
    adapter.loadSessionHistory = async (input) => {
      expect(input.repoPath).toBe("/tmp/repo");
      expect(input.runtimeKind).toBe("opencode");
      expect(input.workingDirectory).toBe("/tmp/repo/worktree");
      return [];
    };

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef,
      taskRef: { current: [taskFixture] },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
      }),
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fork",
          selectedModel: BUILD_SELECTION,
          sourceSession: {
            externalSessionId: "external-source-build",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo/worktree",
          },
        }),
      ).resolves.toEqual(
        expect.objectContaining({ externalSessionId: "external-forked-from-runtime-connection" }),
      );
      expect(forkCalls).toHaveLength(1);
    } finally {
      adapter.forkSession = originalForkSession;
    }
  });

  test("stops the forked session when child history load fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const originalLoadSessionHistory = adapter.loadSessionHistory;
    const originalStopSession = adapter.stopSession;
    const stoppedSessionIds: string[] = [];
    const sessionsRef = createSessionsRef([
      sessionFixture({
        externalSessionId: "external-source-build",
        startedAt: "2026-02-22T08:10:00.000Z",
        contextUsage: null,
        selectedModel: BUILD_SELECTION,
      }),
    ]);

    adapter.forkSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "external-fork-history-failure",
      startedAt: "2026-02-22T08:20:00.000Z",
      role: "build",
      status: "idle",
    });
    adapter.loadSessionHistory = async () => {
      throw new Error("history unavailable");
    };
    adapter.stopSession = async (sessionRef) => {
      stoppedSessionIds.push(
        typeof sessionRef === "string" ? sessionRef : sessionRef.externalSessionId,
      );
    };

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef,
      taskRef: { current: [taskFixture] },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
      }),
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fork",
          selectedModel: BUILD_SELECTION,
          sourceSession: {
            externalSessionId: "external-source-build",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo/worktree",
          },
        }),
      ).rejects.toThrow(
        'Failed to initialize started session "external-fork-history-failure": history unavailable. The started session was stopped before local registration.',
      );
      expect(stoppedSessionIds).toEqual(["external-fork-history-failure"]);
      expect(getSession(sessionsRef.current, "external-fork-history-failure")).toBeUndefined();
    } finally {
      adapter.forkSession = originalForkSession;
      adapter.loadSessionHistory = originalLoadSessionHistory;
      adapter.stopSession = originalStopSession;
    }
  });

  test("stops the forked session when the repo becomes stale after child history load", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const originalLoadSessionHistory = adapter.loadSessionHistory;
    const originalStopSession = adapter.stopSession;
    const stoppedSessionIds: string[] = [];
    const sessionsRef = createSessionsRef([
      sessionFixture({
        externalSessionId: "external-source-build",
        startedAt: "2026-02-22T08:10:00.000Z",
        contextUsage: null,
        selectedModel: BUILD_SELECTION,
      }),
    ]);

    adapter.forkSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "external-forked-stale-after-history",
      startedAt: "2026-02-22T08:20:00.000Z",
      role: "build",
      status: "idle",
    });
    adapter.loadSessionHistory = async () => {
      currentWorkspaceRepoPathRef.current = "/tmp/other";
      return [
        {
          messageId: "child-user-1",
          role: "user",
          state: "read",
          timestamp: "2026-02-22T08:21:00.000Z",
          text: "Hydrated child history",
          displayParts: [],
          parts: [],
        },
      ];
    };
    adapter.stopSession = async (sessionRef) => {
      stoppedSessionIds.push(
        typeof sessionRef === "string" ? sessionRef : sessionRef.externalSessionId,
      );
    };

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef,
      taskRef: { current: [taskFixture] },
      currentWorkspaceRepoPathRef,
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
      }),
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fork",
          selectedModel: BUILD_SELECTION,
          sourceSession: {
            externalSessionId: "external-source-build",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo/worktree",
          },
        }),
      ).rejects.toThrow("Workspace changed while starting session.");
      expect(stoppedSessionIds).toEqual(["external-forked-stale-after-history"]);
      expect(
        getSession(sessionsRef.current, "external-forked-stale-after-history"),
      ).toBeUndefined();
    } finally {
      adapter.forkSession = originalForkSession;
      adapter.loadSessionHistory = originalLoadSessionHistory;
      adapter.stopSession = originalStopSession;
    }
  });
});
