import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { replaceAgentSession } from "@/state/agent-session-collection";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import {
  BUILD_SELECTION,
  createSessionsRef,
  createStartSessionTestHarness,
  getSession,
  sessionFixture,
  taskFixture,
} from "./start-session.test-helpers";

describe("agent-orchestrator/handlers/start-session fork", () => {
  test("rejects forking a legacy repository-root task session", async () => {
    const adapter = new OpencodeSdkAdapter();
    let forkCalls = 0;
    adapter.forkSession = async () => {
      forkCalls += 1;
      throw new Error("unexpected fork");
    };
    const sessionsRef = createSessionsRef([
      sessionFixture({
        externalSessionId: "legacy-root-session",
        workingDirectory: "/tmp/repo-alias",
        historyLoadState: "loaded",
      }),
    ]);
    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef,
      taskRef: { current: [taskFixture] },
      canonicalizePath: async (path) => (path === "/tmp/repo-alias" ? "/tmp/repo" : path),
    });

    await expect(
      start({
        taskId: "task-1",
        role: "build",
        startMode: "fork",
        selectedModel: BUILD_SELECTION,
        sourceSession: {
          externalSessionId: "legacy-root-session",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo-alias",
        },
      }),
    ).rejects.toThrow("Start a fresh session in the task worktree instead");
    expect(forkCalls).toBe(0);
  });
  test("forks from the selected source session for pull request generation", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const originalLoadSessionHistory = adapter.loadSessionHistory;
    const persistedSnapshots: AgentSessionRecord[] = [];
    const sessionsRef = createSessionsRef([
      sessionFixture({
        externalSessionId: "external-source-build",
        startedAt: "2026-02-22T08:10:00.000Z",
        historyLoadState: "loaded",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          profileId: "builder",
        },
      }),
    ]);

    adapter.forkSession = async (input) => {
      expect(input.sessionScope.taskId).toBe("task-1");
      expect(input.sessionScope.role).toBe("build");
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

  test("holds the task startup lease until the fork is durably persisted", async () => {
    const adapter = new OpencodeSdkAdapter();
    const events: string[] = [];
    let finishPersistence: (() => void) | undefined;
    const persistenceBlocked = new Promise<void>((resolve) => {
      finishPersistence = resolve;
    });
    adapter.forkSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "fork-under-lease",
      startedAt: "2026-02-22T08:20:00.000Z",
      role: "build",
      status: "idle",
    });
    adapter.loadSessionHistory = async () => [];

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef: createSessionsRef([
        sessionFixture({
          externalSessionId: "source-under-lease",
          historyLoadState: "loaded",
        }),
      ]),
      taskRef: { current: [taskFixture] },
      prepareTaskSessionStartupLease: async () => {
        events.push("prepare");
        return "fork-lease";
      },
      persistSessionRecord: async () => {
        events.push("persist-start");
        await persistenceBlocked;
        events.push("persist-complete");
      },
      completeTaskSessionStartupLease: async () => {
        events.push("lease-complete");
      },
    });

    const started = start({
      taskId: "task-1",
      role: "build",
      startMode: "fork",
      selectedModel: BUILD_SELECTION,
      sourceSession: {
        externalSessionId: "source-under-lease",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["prepare", "persist-start"]);

    finishPersistence?.();
    await started;
    expect(events).toEqual(["prepare", "persist-start", "persist-complete", "lease-complete"]);
  });

  test("rolls back a stale fork after lease completion without aborting the completed lease", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    const adapter = new OpencodeSdkAdapter();
    const stoppedSessionIds: string[] = [];
    const deletedSessionIds: string[] = [];
    const abortedLeaseIds: string[] = [];
    const sessionsRef = createSessionsRef([
      sessionFixture({
        externalSessionId: "source-stale-after-complete",
        historyLoadState: "loaded",
      }),
    ]);
    adapter.forkSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "fork-stale-after-complete",
      startedAt: "2026-02-22T08:20:00.000Z",
      role: "build",
      status: "idle",
    });
    adapter.loadSessionHistory = async () => [];
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
      prepareTaskSessionStartupLease: async () => "stale-after-complete-lease",
      completeTaskSessionStartupLease: async () => {
        currentWorkspaceRepoPathRef.current = "/tmp/other";
      },
      abortTaskSessionStartupLease: async (_repoPath, _taskId, leaseId) => {
        abortedLeaseIds.push(leaseId);
      },
      deleteSessionRecord: async (_taskId, identity) => {
        deletedSessionIds.push(identity.externalSessionId);
      },
    });

    await expect(
      start({
        taskId: "task-1",
        role: "build",
        startMode: "fork",
        selectedModel: BUILD_SELECTION,
        sourceSession: {
          externalSessionId: "source-stale-after-complete",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        },
      }),
    ).rejects.toThrow("Workspace changed while starting session.");
    expect(stoppedSessionIds).toEqual(["fork-stale-after-complete"]);
    expect(deletedSessionIds).toEqual(["fork-stale-after-complete"]);
    expect(abortedLeaseIds).toEqual([]);
    expect(getSession(sessionsRef.current, "fork-stale-after-complete")).toBeUndefined();
  });

  test("aborts the task startup lease when fork persistence fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const abortedLeaseIds: string[] = [];
    const stoppedSessionIds: string[] = [];
    const sessionsRef = createSessionsRef([
      sessionFixture({
        externalSessionId: "source-persistence-failure",
        historyLoadState: "loaded",
      }),
    ]);
    adapter.forkSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "fork-persistence-failure",
      startedAt: "2026-02-22T08:20:00.000Z",
      role: "build",
      status: "idle",
    });
    adapter.loadSessionHistory = async () => [];
    adapter.stopSession = async (sessionRef) => {
      stoppedSessionIds.push(
        typeof sessionRef === "string" ? sessionRef : sessionRef.externalSessionId,
      );
    };

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef,
      taskRef: { current: [taskFixture] },
      prepareTaskSessionStartupLease: async () => "persistence-failure-lease",
      persistSessionRecord: async () => {
        throw new Error("session store unavailable");
      },
      abortTaskSessionStartupLease: async (_repoPath, _taskId, leaseId) => {
        abortedLeaseIds.push(leaseId);
      },
    });

    await expect(
      start({
        taskId: "task-1",
        role: "build",
        startMode: "fork",
        selectedModel: BUILD_SELECTION,
        sourceSession: {
          externalSessionId: "source-persistence-failure",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        },
      }),
    ).rejects.toThrow("session store unavailable");
    expect(abortedLeaseIds).toEqual(["persistence-failure-lease"]);
    expect(stoppedSessionIds).toEqual(["fork-persistence-failure"]);
    expect(getSession(sessionsRef.current, "fork-persistence-failure")).toBeUndefined();
  });

  test("keeps the task startup lease when persistence rollback cannot stop the fork", async () => {
    const adapter = new OpencodeSdkAdapter();
    const abortedLeaseIds: string[] = [];
    const sessionsRef = createSessionsRef([
      sessionFixture({
        externalSessionId: "source-persistence-stop-failure",
        historyLoadState: "loaded",
      }),
    ]);
    adapter.forkSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "fork-persistence-stop-failure",
      startedAt: "2026-02-22T08:20:00.000Z",
      role: "build",
      status: "idle",
    });
    adapter.loadSessionHistory = async () => [];
    adapter.stopSession = async () => {
      throw new Error("runtime unavailable");
    };

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef,
      taskRef: { current: [taskFixture] },
      prepareTaskSessionStartupLease: async () => "persistence-stop-failure-lease",
      persistSessionRecord: async () => {
        throw new Error("session store unavailable");
      },
      abortTaskSessionStartupLease: async (_repoPath, _taskId, leaseId) => {
        abortedLeaseIds.push(leaseId);
      },
    });

    await expect(
      start({
        taskId: "task-1",
        role: "build",
        startMode: "fork",
        selectedModel: BUILD_SELECTION,
        sourceSession: {
          externalSessionId: "source-persistence-stop-failure",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        },
      }),
    ).rejects.toThrow(
      "Failed to stop the started session during rollback: runtime unavailable. Cleanup was not continued.",
    );
    expect(abortedLeaseIds).toEqual([]);
    expect(getSession(sessionsRef.current, "fork-persistence-stop-failure")).toBeDefined();
  });

  test("acquires the task startup lease before loading stopped source session history", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const originalLoadSessionHistory = adapter.loadSessionHistory;
    const events: string[] = [];
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
        events.push("load-source-history");
        loadAgentSessionHistoryCalls.push(session);
        const sourceBuild = getSession(sessionsRef.current, "external-source-build");
        if (!sourceBuild) {
          throw new Error("Missing external-source-build session");
        }
        const loadedSourceBuild: AgentSessionState = {
          ...sourceBuild,
          historyLoadState: "loaded",
        };
        sessionsRef.current = replaceAgentSession(sessionsRef.current, loadedSourceBuild);
        return loadedSourceBuild;
      },
      prepareTaskSessionStartupLease: async () => {
        events.push("prepare-lease");
        return "source-history-lease";
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
      expect(events).toEqual(["prepare-lease", "load-source-history"]);
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
        historyLoadState: "loaded",
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
    const abortedLeaseIds: string[] = [];
    const sessionsRef = createSessionsRef([
      sessionFixture({
        externalSessionId: "external-source-build",
        startedAt: "2026-02-22T08:10:00.000Z",
        contextUsage: null,
        historyLoadState: "loaded",
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
      prepareTaskSessionStartupLease: async () => "failed-fork-lease",
      abortTaskSessionStartupLease: async (_repoPath, _taskId, leaseId) => {
        abortedLeaseIds.push(leaseId);
      },
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
      expect(abortedLeaseIds).toEqual(["failed-fork-lease"]);
      expect(getSession(sessionsRef.current, "external-fork-history-failure")).toBeUndefined();
    } finally {
      adapter.forkSession = originalForkSession;
      adapter.loadSessionHistory = originalLoadSessionHistory;
      adapter.stopSession = originalStopSession;
    }
  });

  test("keeps the task startup lease when child-history rollback cannot stop the fork", async () => {
    const adapter = new OpencodeSdkAdapter();
    const abortedLeaseIds: string[] = [];
    const sessionsRef = createSessionsRef([
      sessionFixture({
        externalSessionId: "source-child-history-stop-failure",
        historyLoadState: "loaded",
      }),
    ]);
    adapter.forkSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "fork-child-history-stop-failure",
      startedAt: "2026-02-22T08:20:00.000Z",
      role: "build",
      status: "idle",
    });
    adapter.loadSessionHistory = async () => {
      throw new Error("history unavailable");
    };
    adapter.stopSession = async () => {
      throw new Error("runtime unavailable");
    };

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef,
      taskRef: { current: [taskFixture] },
      prepareTaskSessionStartupLease: async () => "child-history-stop-failure-lease",
      abortTaskSessionStartupLease: async (_repoPath, _taskId, leaseId) => {
        abortedLeaseIds.push(leaseId);
      },
    });

    await expect(
      start({
        taskId: "task-1",
        role: "build",
        startMode: "fork",
        selectedModel: BUILD_SELECTION,
        sourceSession: {
          externalSessionId: "source-child-history-stop-failure",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        },
      }),
    ).rejects.toThrow("Failed to stop the started session during rollback: runtime unavailable");
    expect(abortedLeaseIds).toEqual([]);
    expect(getSession(sessionsRef.current, "fork-child-history-stop-failure")).toBeUndefined();
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
        historyLoadState: "loaded",
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
