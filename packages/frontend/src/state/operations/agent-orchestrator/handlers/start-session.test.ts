import { beforeEach, describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentModelSelection, StartAgentSessionInput } from "@openducktor/core";
import { createSessionStartGate } from "@/features/session-start/session-start-gate";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { clearAppQueryClient } from "@/lib/query-client";
import {
  type AgentSessionCollection,
  emptyAgentSessionCollection,
  listAgentSessions,
} from "@/state/agent-session-collection";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { withCapturedConsole } from "@/test-utils/console-capture";
import { sessionMessageAt } from "@/test-utils/session-message-test-helpers";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { host } from "../../shared/host";
import { createDeferred, createTaskCardFixture, withTimeout } from "../test-utils";
import {
  BUILD_SELECTION,
  continuationTarget,
  createSessionsRef,
  createStartSessionTestHarness,
  getSession,
  PLANNER_SELECTION,
  QA_SELECTION,
  sessionIdentity,
  taskFixture,
} from "./start-session.test-helpers";

const waitForSessionCount = async (
  getCount: () => number,
  expectedCount: number,
  remainingAttempts = 10,
): Promise<void> => {
  if (getCount() === expectedCount) {
    return;
  }
  if (remainingAttempts <= 0) {
    return;
  }
  await Promise.resolve();
  await Promise.resolve();
  await waitForSessionCount(getCount, expectedCount, remainingAttempts - 1);
};

describe("agent-orchestrator/handlers/start-session", () => {
  beforeEach(async () => {
    await clearAppQueryClient();
  });

  test("throws when no active repo is selected", () => {
    const { start } = createStartSessionTestHarness({
      activeRepo: null,
      repoEpochRef: { current: 0 },
      currentWorkspaceRepoPathRef: { current: null },
    });

    expect(
      start({
        taskId: "task-1",
        role: "build",
        startMode: "fresh",
        selectedModel: BUILD_SELECTION,
      }),
    ).rejects.toThrow("Active workspace repo path is unavailable.");
  });

  test("starts through a normalized workflow control without loading runtime policy settings", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    let startInput: unknown;
    adapter.startSession = async (input) => {
      startInput = input;
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "session-normalized",
        startedAt: "2026-02-22T08:00:10.000Z",
        role: input.sessionScope.role,
        status: "idle",
      };
    };
    const { start } = createStartSessionTestHarness({
      adapter,
      taskRef: { current: [taskFixture] },
      loadSettingsSnapshot: async () => {
        throw new Error("session control must not load runtime policy settings");
      },
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
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        }),
      ).resolves.toMatchObject({ externalSessionId: "session-normalized" });
      expect(startInput).toMatchObject({
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      });
      expect(startInput).not.toHaveProperty("runtimePolicy");
    } finally {
      adapter.startSession = originalStartSession;
    }
  });

  test("reuses an existing in-flight start promise", async () => {
    const inFlight = createDeferred<ReturnType<typeof sessionIdentity>>();
    const sessionStartGate = createSessionStartGate<AgentSessionIdentity>();
    void sessionStartGate.run(
      [
        "/tmp/repo",
        "task-1",
        "build",
        "reuse",
        agentSessionIdentityKey(sessionIdentity("session-in-flight", "/tmp/repo/worktree")),
        "",
        "",
        "no-post-start-message",
      ].join("::"),
      () => inFlight.promise,
    );
    const sessionsRef = createSessionsRef();
    const { start } = createStartSessionTestHarness({
      sessionsRef,
      sessionStartGateRef: { current: sessionStartGate },
    });

    const startPromise = start({
      taskId: "task-1",
      role: "build",
      startMode: "reuse",
      sourceSession: {
        externalSessionId: "session-in-flight",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      },
    });

    inFlight.resolve(sessionIdentity("session-in-flight", "/tmp/repo/worktree"));
    await expect(startPromise).resolves.toEqual(
      sessionIdentity("session-in-flight", "/tmp/repo/worktree"),
    );
  });

  test("does not dedupe in-flight starts across different roles", async () => {
    const startBuildDeferred = createDeferred<void>();
    const startedRoles: string[] = [];
    const buildStarted = createDeferred<void>();
    const plannerStarted = createDeferred<void>();

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => {
      startedRoles.push(input.sessionScope.role);
      if (input.sessionScope.role === "build") {
        buildStarted.resolve();
        await startBuildDeferred.promise;
      } else {
        plannerStarted.resolve();
      }
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: `${input.sessionScope.role}-external`,
        startedAt: "2026-02-22T08:00:10.000Z",
        role: input.sessionScope.role,
        status: "idle",
      };
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { start } = createStartSessionTestHarness({
      adapter,
      taskRef: { current: [taskFixture] },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      const buildPromise = start({
        taskId: "task-1",
        role: "build",
        startMode: "fresh",
        selectedModel: BUILD_SELECTION,
      });
      await Promise.resolve();
      const plannerPromise = start({
        taskId: "task-1",
        role: "planner",
        startMode: "fresh",
        selectedModel: BUILD_SELECTION,
      });
      await buildStarted.promise;
      const plannerStartResult = await withTimeout(plannerStarted.promise, 50);

      expect(new Set(startedRoles)).toEqual(new Set(["build", "planner"]));
      expect(plannerStartResult).toBeUndefined();

      startBuildDeferred.resolve();
      await expect(buildPromise).resolves.toEqual(
        expect.objectContaining({ externalSessionId: "build-external" }),
      );
      await expect(plannerPromise).resolves.toEqual(
        expect.objectContaining({ externalSessionId: "planner-external" }),
      );
    } finally {
      startBuildDeferred.resolve();
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("keys fresh starts by selected model", async () => {
    const startKeys: string[] = [];

    const { start } = createStartSessionTestHarness({
      sessionStartGateRef: {
        current: {
          run: async (key, startSession) => {
            startKeys.push(key);
            if (key.endsWith("::build::no-post-start-message")) {
              return sessionIdentity("session-model");
            }
            if (key.endsWith("::planner::no-post-start-message")) {
              return sessionIdentity("session-profile");
            }
            return startSession();
          },
          clear: () => {},
        },
      },
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree"),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
      }),
    });

    await expect(
      start({
        taskId: "task-1",
        role: "build",
        startMode: "fresh",
        selectedModel: BUILD_SELECTION,
      }),
    ).resolves.toEqual(expect.objectContaining({ externalSessionId: "session-model" }));

    await expect(
      start({
        taskId: "task-1",
        role: "build",
        startMode: "fresh",
        selectedModel: {
          ...BUILD_SELECTION,
          profileId: "planner",
        },
      }),
    ).resolves.toEqual(expect.objectContaining({ externalSessionId: "session-profile" }));
    expect(startKeys).toEqual([
      expect.stringMatching(/::build::no-post-start-message$/),
      expect.stringMatching(/::planner::no-post-start-message$/),
    ]);
  });

  test("keys fresh starts by post-start message hold policy", async () => {
    const startKeys: string[] = [];

    const { start } = createStartSessionTestHarness({
      sessionStartGateRef: {
        current: {
          run: async (key) => {
            startKeys.push(key);
            return sessionIdentity(
              key.endsWith("::post-start-message") ? "session-held" : "session-plain",
            );
          },
          clear: () => {},
        },
      },
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree"),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
      }),
    });

    await expect(
      start({
        taskId: "task-1",
        role: "build",
        startMode: "fresh",
        selectedModel: BUILD_SELECTION,
      }),
    ).resolves.toEqual(expect.objectContaining({ externalSessionId: "session-plain" }));

    await expect(
      start({
        taskId: "task-1",
        role: "build",
        startMode: "fresh",
        selectedModel: BUILD_SELECTION,
        holdForPostStartMessage: true,
      }),
    ).resolves.toEqual(expect.objectContaining({ externalSessionId: "session-held" }));

    expect(startKeys).toEqual([
      expect.stringMatching(/::build::no-post-start-message$/),
      expect.stringMatching(/::build::post-start-message$/),
    ]);
  });

  test("waits for the initial session snapshot to persist before resolving", async () => {
    const persistDeferred = createDeferred<void>();
    let sessionCollection: AgentSessionCollection = emptyAgentSessionCollection();
    const sessionsRef = { current: sessionCollection };
    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "planner-external",
      startedAt: "2026-02-22T08:00:10.000Z",
      role: "planner",
      status: "idle",
    });

    const { start } = createStartSessionTestHarness({
      adapter,
      onSessionCollectionChange: (collection) => {
        sessionCollection = collection;
      },
      sessionsRef,
      taskRef: { current: [taskFixture] },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo",
      }),
      persistSessionRecord: async () => {
        await persistDeferred.promise;
      },
    });

    try {
      const startPromise = start({
        taskId: "task-1",
        role: "planner",
        startMode: "fresh",
        selectedModel: PLANNER_SELECTION,
        holdForPostStartMessage: true,
      });

      await waitForSessionCount(() => listAgentSessions(sessionCollection).length, 1);

      expect(listAgentSessions(sessionCollection)).toHaveLength(1);
      expect(listAgentSessions(sessionCollection)[0]?.status).toBe("starting");
      await expect(withTimeout(startPromise, 25)).resolves.toBe("timeout");

      persistDeferred.resolve();

      await expect(startPromise).resolves.toEqual(
        expect.objectContaining({ externalSessionId: "planner-external" }),
      );
    } finally {
      persistDeferred.resolve();
      adapter.startSession = originalStartSession;
    }
  });

  test("keeps held fresh sessions starting after local registration", async () => {
    let sessionCollection: AgentSessionCollection = emptyAgentSessionCollection();
    const lifecycleEvents: string[] = [];
    const sessionsRef = { current: sessionCollection };
    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "planner-external",
      startedAt: "2026-02-22T08:00:10.000Z",
      role: "planner",
      status: "idle",
    });

    const { start } = createStartSessionTestHarness({
      adapter,
      onSessionCollectionChange: (collection) => {
        sessionCollection = collection;
        lifecycleEvents.push(
          `status:${getSession(sessionCollection, "planner-external")?.status ?? "missing"}`,
        );
      },
      sessionsRef,
      taskRef: { current: [taskFixture] },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "planner",
          startMode: "fresh",
          selectedModel: PLANNER_SELECTION,
          holdForPostStartMessage: true,
        }),
      ).resolves.toEqual(expect.objectContaining({ externalSessionId: "planner-external" }));

      expect(getSession(sessionCollection, "planner-external")?.status).toBe("starting");
      expect(getSession(sessionCollection, "planner-external")?.historyLoadState).toBe(
        "not_requested",
      );
      expect(lifecycleEvents).not.toContain("status:idle");
    } finally {
      adapter.startSession = originalStartSession;
    }
  });

  test("publishes message-first starts to agent activity before persistence finishes", async () => {
    const persistDeferred = createDeferred<void>();
    const sessionStore = createAgentSessionsStore("/tmp/repo");
    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "message-first-session",
      startedAt: "2026-02-22T08:00:10.000Z",
      role: "planner",
      status: "idle",
    });

    const { start } = createStartSessionTestHarness({
      adapter,
      replaceSession: sessionStore.replaceSession,
      removeSession: sessionStore.removeSession,
      readSessionSnapshot: sessionStore.getSessionSnapshot,
      taskRef: { current: [taskFixture] },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo",
      }),
      persistSessionRecord: async () => {
        await persistDeferred.promise;
      },
    });

    try {
      const startPromise = start({
        taskId: "task-1",
        role: "planner",
        startMode: "fresh",
        selectedModel: PLANNER_SELECTION,
        holdForPostStartMessage: true,
      });

      await waitForSessionCount(() => sessionStore.getActivitySnapshot().sessions.length, 1);

      expect(sessionStore.getActivitySnapshot().sessions).toEqual([
        expect.objectContaining({
          externalSessionId: "message-first-session",
          activityState: "starting",
        }),
      ]);
      await expect(withTimeout(startPromise, 25)).resolves.toBe("timeout");

      persistDeferred.resolve();
      await expect(startPromise).resolves.toEqual(
        expect.objectContaining({ externalSessionId: "message-first-session" }),
      );
    } finally {
      persistDeferred.resolve();
      adapter.startSession = originalStartSession;
    }
  });

  test("persists only durable session record fields during start", async () => {
    let persistedTaskId: string | null = null;
    let persistedRecord: AgentSessionRecord | null = null;
    const adapter = new OpencodeSdkAdapter();
    adapter.startSession = async (input: StartAgentSessionInput) => ({
      externalSessionId: "external-1",
      runtimeKind: input.runtimeKind,
      workingDirectory: input.workingDirectory,
      role: "planner",
      startedAt: "2026-03-21T10:00:00.000Z",
      status: "running",
    });
    const { start } = createStartSessionTestHarness({
      taskRef: {
        current: [createTaskCardFixture({ id: "task-1", status: "open" })],
      },
      adapter,
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree"),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo",
      }),
      persistSessionRecord: async (taskId, record) => {
        persistedTaskId = taskId;
        persistedRecord = record;
      },
    });

    await start({
      taskId: "task-1",
      role: "planner",
      startMode: "fresh",
      selectedModel: PLANNER_SELECTION,
    });

    if (persistedTaskId !== "task-1") {
      throw new Error(`Expected persisted task id task-1, received ${String(persistedTaskId)}`);
    }
    if (!persistedRecord) {
      throw new Error("Expected persisted record to be captured.");
    }
    const persistedSessionRecord = persistedRecord as AgentSessionRecord;

    expect(persistedSessionRecord.externalSessionId).toBe("external-1");
    expect("status" in persistedSessionRecord).toBe(false);
    expect("taskId" in persistedSessionRecord).toBe(false);
    expect("runtimeEndpoint" in persistedSessionRecord).toBe(false);
    expect("baseUrl" in persistedSessionRecord).toBe(false);
    expect("runtimeTransport" in persistedSessionRecord).toBe(false);
  });

  test("stops and removes the started session when initial persistence fails", async () => {
    const stoppedSessionIds: string[] = [];
    const deletedSessionIds: string[] = [];
    const sessionsRef = { current: emptyAgentSessionCollection() };
    const adapter = new OpencodeSdkAdapter();
    adapter.startSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "external-session-persist-fail",
      role: "planner",
      status: "running",
      startedAt: "2026-02-22T08:00:00.000Z",
    });
    adapter.stopSession = async (sessionRef) => {
      stoppedSessionIds.push(
        typeof sessionRef === "string" ? sessionRef : sessionRef.externalSessionId,
      );
    };

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef,
      taskRef: { current: [{ ...taskFixture, id: "task-1" }] },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo",
      }),
      persistSessionRecord: async () => {
        throw new Error("persist failed");
      },
      deleteSessionRecord: async (_taskId, identity) => {
        deletedSessionIds.push(identity.externalSessionId);
      },
    });

    await withCapturedConsole("error", async (calls) => {
      await expect(
        start({
          taskId: "task-1",
          role: "planner",
          startMode: "fresh",
          selectedModel: PLANNER_SELECTION,
        }),
      ).rejects.toThrow(
        'Failed to persist started session "external-session-persist-fail": persist failed. The started session was stopped and removed locally. The durable session record was deleted.',
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[0]).toBe("[agent-orchestrator]");
      expect(calls[0]?.[1]).toBe("start-session-persist-initial-session");
    });

    expect(stoppedSessionIds).toEqual(["external-session-persist-fail"]);
    expect(deletedSessionIds).toEqual(["external-session-persist-fail"]);
    expect(getSession(sessionsRef.current, "external-session-persist-fail")).toBeUndefined();
  });

  test("deletes the durable record when bootstrap completion fails after persistence", async () => {
    const deletedSessionIds: string[] = [];
    let abortCalls = 0;
    let stopCalls = 0;
    const adapter = new OpencodeSdkAdapter();
    adapter.startSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "external-bootstrap-fail",
      role: "planner",
      status: "running",
      startedAt: "2026-02-22T08:00:00.000Z",
    });
    adapter.stopSession = async () => {
      stopCalls += 1;
    };

    const { start } = createStartSessionTestHarness({
      adapter,
      taskRef: { current: [{ ...taskFixture, id: "task-1" }] },
      ensureRuntime: async () => ({
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        bootstrap: {
          complete: async () => {
            throw new Error("bootstrap completion failed");
          },
          abort: async () => {
            abortCalls += 1;
          },
        },
      }),
      deleteSessionRecord: async (_taskId, identity) => {
        deletedSessionIds.push(identity.externalSessionId);
      },
    });

    await expect(
      start({
        taskId: "task-1",
        role: "planner",
        startMode: "fresh",
        selectedModel: PLANNER_SELECTION,
      }),
    ).rejects.toThrow("bootstrap completion failed");
    expect(stopCalls).toBe(1);
    expect(deletedSessionIds).toEqual(["external-bootstrap-fail"]);
    expect(abortCalls).toBe(1);
  });

  test("preserves a registered fresh session when rollback cannot stop it", async () => {
    const sessionsRef = { current: emptyAgentSessionCollection() };
    const deletedSessionIds: string[] = [];
    let abortCalls = 0;
    const adapter = new OpencodeSdkAdapter();
    adapter.startSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "external-stop-fail",
      role: "planner",
      status: "running",
      startedAt: "2026-02-22T08:00:00.000Z",
    });
    adapter.stopSession = async () => {
      throw new Error("runtime unavailable");
    };

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef,
      taskRef: { current: [{ ...taskFixture, id: "task-1" }] },
      ensureRuntime: async () => ({
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        bootstrap: {
          complete: async () => {
            throw new Error("bootstrap completion failed");
          },
          abort: async () => {
            abortCalls += 1;
          },
        },
      }),
      deleteSessionRecord: async (_taskId, identity) => {
        deletedSessionIds.push(identity.externalSessionId);
      },
    });

    await expect(
      start({
        taskId: "task-1",
        role: "planner",
        startMode: "fresh",
        selectedModel: PLANNER_SELECTION,
      }),
    ).rejects.toThrow(
      "Failed to stop the started session during rollback: runtime unavailable. Cleanup was not continued.",
    );
    expect(getSession(sessionsRef.current, "external-stop-fail")).toBeDefined();
    expect(deletedSessionIds).toEqual([]);
    expect(abortCalls).toBe(0);
  });

  test("preserves fresh bootstrap resources when stale-session cleanup cannot stop the runtime", async () => {
    const repoEpochRef = { current: 1 };
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" };
    let abortCalls = 0;
    const adapter = new OpencodeSdkAdapter();
    adapter.startSession = async (input) => {
      repoEpochRef.current += 1;
      currentWorkspaceRepoPathRef.current = "/tmp/other-repo";
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "external-stale-stop-fail",
        role: "planner",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
      };
    };
    adapter.stopSession = async () => {
      throw new Error("runtime unavailable");
    };

    const { start } = createStartSessionTestHarness({
      adapter,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
      taskRef: { current: [{ ...taskFixture, id: "task-1" }] },
      ensureRuntime: async () => ({
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        bootstrap: {
          complete: async () => {},
          abort: async () => {
            abortCalls += 1;
          },
        },
      }),
    });

    await expect(
      start({
        taskId: "task-1",
        role: "planner",
        startMode: "fresh",
        selectedModel: PLANNER_SELECTION,
      }),
    ).rejects.toThrow(
      "Failed to stop stale started session 'external-stale-stop-fail': runtime unavailable",
    );
    expect(abortCalls).toBe(0);
  });

  test("preserves the registered session and commits bootstrap resources when durable deletion fails", async () => {
    const sessionsRef = { current: emptyAgentSessionCollection() };
    let completeCalls = 0;
    let abortCalls = 0;
    const adapter = new OpencodeSdkAdapter();
    adapter.startSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "external-falsy-rollback-errors",
      role: "planner",
      status: "running",
      startedAt: "2026-02-22T08:00:00.000Z",
    });
    adapter.stopSession = async () => {};

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef,
      taskRef: { current: [{ ...taskFixture, id: "task-1" }] },
      ensureRuntime: async () => ({
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        bootstrap: {
          complete: async () => {
            completeCalls += 1;
          },
          abort: async () => {
            abortCalls += 1;
          },
        },
      }),
      persistSessionRecord: async () => {
        throw new Error("persist failed");
      },
      deleteSessionRecord: () => Promise.reject(undefined),
    });

    await expect(
      start({
        taskId: "task-1",
        role: "planner",
        startMode: "fresh",
        selectedModel: PLANNER_SELECTION,
      }),
    ).rejects.toThrow(
      "Failed to delete the durable session record: Non-Error thrown: undefined. The stopped session remains registered locally and durably for recovery. The task worktree bootstrap was committed to preserve its resources.",
    );
    expect(completeCalls).toBe(1);
    expect(abortCalls).toBe(0);
    expect(getSession(sessionsRef.current, "external-falsy-rollback-errors")).toBeDefined();
  });

  test("preserves a fresh non-Builder session when the repository changes after bootstrap commits", async () => {
    const completionStarted = createDeferred<void>();
    const completion = createDeferred<void>();
    const repoEpochRef = { current: 1 };
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" };
    const deletedSessionIds: string[] = [];
    let abortCalls = 0;
    let stopCalls = 0;
    const adapter = new OpencodeSdkAdapter();
    adapter.startSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "external-stale-bootstrap",
      role: "planner",
      status: "running",
      startedAt: "2026-02-22T08:00:00.000Z",
    });
    adapter.stopSession = async () => {
      stopCalls += 1;
    };

    const { start } = createStartSessionTestHarness({
      adapter,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
      taskRef: { current: [{ ...taskFixture, id: "task-1" }] },
      ensureRuntime: async () => ({
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        bootstrap: {
          complete: async () => {
            completionStarted.resolve();
            await completion.promise;
          },
          abort: async () => {
            abortCalls += 1;
          },
        },
      }),
      deleteSessionRecord: async (_taskId, identity) => {
        deletedSessionIds.push(identity.externalSessionId);
      },
    });

    const startPromise = start({
      taskId: "task-1",
      role: "planner",
      startMode: "fresh",
      selectedModel: PLANNER_SELECTION,
    });
    await completionStarted.promise;
    repoEpochRef.current += 1;
    currentWorkspaceRepoPathRef.current = "/tmp/other-repo";
    completion.resolve();

    await expect(startPromise).rejects.toThrow("Workspace changed while starting session");
    expect(stopCalls).toBe(0);
    expect(deletedSessionIds).toEqual([]);
    expect(abortCalls).toBe(0);
  });

  test("preserves a fresh Builder session when the repository changes after bootstrap commits", async () => {
    const completionStarted = createDeferred<void>();
    const completion = createDeferred<void>();
    const repoEpochRef = { current: 1 };
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" };
    const deletedSessionIds: string[] = [];
    let abortCalls = 0;
    let stopCalls = 0;
    const adapter = new OpencodeSdkAdapter();
    adapter.startSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "external-committed-builder",
      role: "build",
      status: "running",
      startedAt: "2026-02-22T08:00:00.000Z",
    });
    adapter.stopSession = async () => {
      stopCalls += 1;
    };

    const { start } = createStartSessionTestHarness({
      adapter,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
      taskRef: { current: [{ ...taskFixture, id: "task-1" }] },
      ensureRuntime: async () => ({
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        bootstrap: {
          complete: async () => {
            completionStarted.resolve();
            await completion.promise;
          },
          abort: async () => {
            abortCalls += 1;
          },
        },
      }),
      deleteSessionRecord: async (_taskId, identity) => {
        deletedSessionIds.push(identity.externalSessionId);
      },
    });

    const startPromise = start({
      taskId: "task-1",
      role: "build",
      startMode: "fresh",
      selectedModel: BUILD_SELECTION,
    });
    await completionStarted.promise;
    repoEpochRef.current += 1;
    currentWorkspaceRepoPathRef.current = "/tmp/other-repo";
    completion.resolve();

    await expect(startPromise).rejects.toThrow("Workspace changed while starting session");
    expect(stopCalls).toBe(0);
    expect(deletedSessionIds).toEqual([]);
    expect(abortCalls).toBe(0);
  });

  test("clears session observation state when bootstrap completion fails", async () => {
    const clearedIdentities: AgentSessionIdentity[] = [];
    const adapter = new OpencodeSdkAdapter();
    adapter.startSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "external-bootstrap-fail",
      role: "planner",
      status: "running",
      startedAt: "2026-02-22T08:00:00.000Z",
    });
    adapter.stopSession = async () => {};

    const { start } = createStartSessionTestHarness({
      adapter,
      taskRef: { current: [{ ...taskFixture, id: "task-1" }] },
      clearSessionObservationState: (identity) => {
        clearedIdentities.push(identity);
      },
      ensureRuntime: async () => ({
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        bootstrap: {
          complete: async () => {
            throw new Error("bootstrap completion failed");
          },
          abort: async () => {},
        },
      }),
    });

    await expect(
      start({
        taskId: "task-1",
        role: "planner",
        startMode: "fresh",
        selectedModel: PLANNER_SELECTION,
      }),
    ).rejects.toThrow("bootstrap completion failed");
    const identity = sessionIdentity("external-bootstrap-fail", "/tmp/repo/worktree");
    expect(clearedIdentities).toEqual([identity]);
  });

  test("does not retry failed bootstrap completion when durable deletion also fails", async () => {
    const sessionsRef = { current: emptyAgentSessionCollection() };
    let completeCalls = 0;
    let abortCalls = 0;
    const adapter = new OpencodeSdkAdapter();
    adapter.startSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "external-bootstrap-delete-fail",
      role: "planner",
      status: "running",
      startedAt: "2026-02-22T08:00:00.000Z",
    });
    adapter.stopSession = async () => {};

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef,
      taskRef: { current: [{ ...taskFixture, id: "task-1" }] },
      ensureRuntime: async () => ({
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        bootstrap: {
          complete: async () => {
            completeCalls += 1;
            throw new Error("bootstrap completion failed");
          },
          abort: async () => {
            abortCalls += 1;
          },
        },
      }),
      deleteSessionRecord: async () => {
        throw new Error("durable delete failed");
      },
    });

    await expect(
      start({
        taskId: "task-1",
        role: "planner",
        startMode: "fresh",
        selectedModel: PLANNER_SELECTION,
      }),
    ).rejects.toThrow(
      "The task worktree resources were left intact without retrying bootstrap completion.",
    );
    expect(completeCalls).toBe(1);
    expect(abortCalls).toBe(0);
    expect(getSession(sessionsRef.current, "external-bootstrap-delete-fail")).toBeDefined();
  });

  test("throws when task is missing after reuse checks", async () => {
    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    let startCalls = 0;
    adapter.startSession = async (input) => {
      startCalls += 1;
      return originalStartSession(input);
    };

    const { start } = createStartSessionTestHarness({
      adapter,
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        }),
      ).rejects.toThrow("Task not found: task-1");
      expect(startCalls).toBe(0);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
      adapter.startSession = originalStartSession;
    }
  });

  test("rejects start when selected role is unavailable for the task", async () => {
    let runtimeCalls = 0;

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { start } = createStartSessionTestHarness({
      taskRef: {
        current: [
          createTaskCardFixture({
            id: "task-1",
            status: "open",
            agentWorkflows: {
              spec: {
                required: true,
                canSkip: false,
                available: true,
                completed: false,
              },
              planner: {
                required: true,
                canSkip: false,
                available: false,
                completed: false,
              },
              builder: {
                required: true,
                canSkip: false,
                available: false,
                completed: false,
              },
              qa: {
                required: true,
                canSkip: false,
                available: false,
                completed: false,
              },
            },
          }),
        ],
      },
      ensureRuntime: async () => {
        runtimeCalls += 1;
        return {
          kind: "opencode",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo",
        };
      },
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        }),
      ).rejects.toThrow("Role 'build' is unavailable for task 'task-1' in status 'open'.");
      expect(runtimeCalls).toBe(0);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("rejects qa start before resolving a review target when qa is unavailable", async () => {
    let qaTargetCalls = 0;

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { start } = createStartSessionTestHarness({
      taskRef: {
        current: [
          createTaskCardFixture({
            id: "task-1",
            status: "open",
            agentWorkflows: {
              spec: {
                required: true,
                canSkip: false,
                available: true,
                completed: false,
              },
              planner: {
                required: true,
                canSkip: false,
                available: false,
                completed: false,
              },
              builder: {
                required: true,
                canSkip: false,
                available: false,
                completed: false,
              },
              qa: {
                required: true,
                canSkip: false,
                available: false,
                completed: false,
              },
            },
          }),
        ],
      },
      resolveTaskWorktree: async () => {
        qaTargetCalls += 1;
        return continuationTarget("/tmp/repo/worktree");
      },
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "qa",
          startMode: "fresh",
          selectedModel: QA_SELECTION,
        }),
      ).rejects.toThrow("Role 'qa' is unavailable for task 'task-1' in status 'open'.");
      expect(qaTargetCalls).toBe(0);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("lets host bootstrap resolve the canonical worktree for qa start", async () => {
    let qaTargetCalls = 0;
    const ensuredWorkingDirectories: Array<string | null | undefined> = [];
    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => ({
      externalSessionId: "external-qa",
      workingDirectory: input.workingDirectory,
      role: input.sessionScope.role,
      startedAt: "2026-02-22T08:00:00.000Z",
      status: "idle",
      runtimeKind: input.runtimeKind,
    });

    const { start } = createStartSessionTestHarness({
      adapter,
      taskRef: {
        current: [
          createTaskCardFixture({
            id: "task-1",
            status: "human_review",
            agentWorkflows: {
              spec: {
                required: false,
                canSkip: true,
                available: true,
                completed: true,
              },
              planner: {
                required: false,
                canSkip: true,
                available: true,
                completed: true,
              },
              builder: {
                required: true,
                canSkip: false,
                available: true,
                completed: true,
              },
              qa: {
                required: true,
                canSkip: false,
                available: true,
                completed: false,
              },
            },
          }),
        ],
      },
      resolveTaskWorktree: async () => {
        qaTargetCalls += 1;
        return continuationTarget("/tmp/repo/worktree");
      },
      ensureRuntime: async (_repoPath, _taskId, _role, options) => {
        ensuredWorkingDirectories.push(options?.targetWorkingDirectory);
        return {
          kind: "opencode",
          runtimeKind: "opencode",
          workingDirectory: options?.targetWorkingDirectory ?? "/tmp/repo",
        };
      },
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "qa",
          startMode: "fresh",
          selectedModel: QA_SELECTION,
        }),
      ).resolves.toEqual(expect.objectContaining({ externalSessionId: "external-qa" }));
      expect(qaTargetCalls).toBe(0);
      expect(ensuredWorkingDirectories).toEqual([undefined]);
    } finally {
      adapter.startSession = originalStartSession;
    }
  });

  test("creates a fresh session without sending a kickoff", async () => {
    let persistCalls = 0;
    let kickoffCalls = 0;
    let refreshCalls = 0;
    let startCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => {
      startCalls += 1;
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "external-created",
        startedAt: "2026-02-22T08:00:10.000Z",
        role: "build",
        status: "idle",
      };
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { sessionsRef, start } = createStartSessionTestHarness({
      adapter,
      taskRef: { current: [taskFixture] },
      refreshTaskData: async () => {
        refreshCalls += 1;
      },
      persistSessionRecord: async () => {
        persistCalls += 1;
      },
      sendAgentMessage: async () => {
        kickoffCalls += 1;
      },
    });

    try {
      const externalSessionId = await start({
        taskId: "task-1",
        role: "build",
        startMode: "fresh",
        selectedModel: BUILD_SELECTION,
      });
      expect(externalSessionId).toEqual(
        expect.objectContaining({ externalSessionId: "external-created" }),
      );
      expect(startCalls).toBe(1);
      expect(persistCalls).toBe(1);
      expect(kickoffCalls).toBe(0);
      expect(refreshCalls).toBe(0);
      expect(getSession(sessionsRef.current, "external-created")).toBeDefined();
      const createdSession = getSession(sessionsRef.current, "external-created");
      expect(createdSession).toBeDefined();
      expect(createdSession?.historyLoadState).toBe("not_requested");
      const createdHeaderMessage = createdSession ? sessionMessageAt(createdSession, 0) : undefined;
      expect(createdHeaderMessage).toEqual({
        id: "history:system-prompt:external-created",
        role: "system",
        content: createdHeaderMessage?.content ?? "",
        timestamp: "2026-02-22T08:00:10.000Z",
      });
      expect(createdHeaderMessage?.content).toContain("System prompt:");
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("does not start a runtime when prompt override loading fails", async () => {
    let runtimeCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async () => {
      throw new Error("startSession should not be reached");
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { start } = createStartSessionTestHarness({
      adapter,
      taskRef: { current: [taskFixture] },
      ensureRuntime: async () => {
        runtimeCalls += 1;
        return {
          kind: "opencode",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        };
      },
      loadTaskDocuments: async () => {
        throw new Error("prompt load failed");
      },
      loadRepoPromptOverrides: async () => {
        throw new Error("prompt override load failed");
      },
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        }),
      ).rejects.toThrow("prompt override load failed");
      expect(runtimeCalls).toBe(0);
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  for (const runtimeKind of [undefined, "", "  "] as const) {
    const caseLabel = runtimeKind === undefined ? "missing" : "blank";

    test(`does not start a fresh session when selected model runtime kind is ${caseLabel}`, async () => {
      let runtimeCalls = 0;
      let startCalls = 0;
      let persistCalls = 0;

      const adapter = new OpencodeSdkAdapter();
      const originalStartSession = adapter.startSession;
      adapter.startSession = async () => {
        startCalls += 1;
        throw new Error("startSession should not be reached");
      };

      const selectedModel = (() => {
        if (runtimeKind === undefined) {
          const { runtimeKind: _runtimeKind, ...selectionWithoutRuntime } = BUILD_SELECTION;
          return selectionWithoutRuntime as AgentModelSelection;
        }
        return {
          ...BUILD_SELECTION,
          runtimeKind,
        } as unknown as AgentModelSelection;
      })();

      const { start } = createStartSessionTestHarness({
        adapter,
        taskRef: { current: [taskFixture] },
        resolveTaskWorktree: async () => ({
          workingDirectory: "/tmp/repo/worktree",
          source: "active_build_run",
        }),
        ensureRuntime: async () => {
          runtimeCalls += 1;
          return {
            kind: "opencode",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo/worktree",
          };
        },
        persistSessionRecord: async () => {
          persistCalls += 1;
        },
      });

      try {
        const expectedError = runtimeKind
          ? `Unsupported runtime kind '${runtimeKind}'.`
          : "Runtime kind is required to start build sessions. Select an explicit runtime before starting a session.";

        await expect(
          start({
            taskId: "task-1",
            role: "build",
            startMode: "fresh",
            selectedModel,
          }),
        ).rejects.toThrow(expectedError);
        expect(runtimeCalls).toBe(0);
        expect(startCalls).toBe(0);
        expect(persistCalls).toBe(0);
      } finally {
        adapter.startSession = originalStartSession;
      }
    });
  }

  test("passes the selected model to adapter session creation", async () => {
    const selectedModel: AgentModelSelection = {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "Hephaestus",
    };
    let observedStartInput: { model?: AgentModelSelection } | null = null;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => {
      observedStartInput = input;
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "external-created",
        startedAt: "2026-02-22T08:00:10.000Z",
        role: "build",
        status: "idle",
      };
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { start } = createStartSessionTestHarness({
      adapter,
      taskRef: { current: [taskFixture] },
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          selectedModel,
          startMode: "fresh",
        }),
      ).resolves.toEqual(expect.objectContaining({ externalSessionId: "external-created" }));
      if (observedStartInput === null) {
        throw new Error("Expected adapter.startSession to receive input.");
      }
      expect(observedStartInput).toMatchObject({ model: selectedModel });
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });
});
