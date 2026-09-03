import { beforeEach, describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { AgentModelSelection, AgentSessionSummary } from "@openducktor/core";
import { createSessionStartGate } from "@/features/session-start/session-start-gate";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { clearAppQueryClient } from "@/lib/query-client";
import {
  type AgentSessionCollection,
  emptyAgentSessionCollection,
  listAgentSessions,
} from "@/state/agent-session-collection";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { sessionMessageAt } from "@/test-utils/session-message-test-helpers";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { host } from "../../shared/host";
import { createDeferred, createTaskCardFixture, withTimeout } from "../test-utils";
import {
  BUILD_SELECTION,
  createSessionsRef,
  createStartSessionTestHarness,
  getSession,
  PLANNER_SELECTION,
  QA_SELECTION,
  sessionIdentity,
  taskFixture,
} from "./start-session.test-helpers";
import { createOpenCodeAgentEngineTestAdapter } from "./opencode-agent-engine.test-support";

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
    const adapter = createOpenCodeAgentEngineTestAdapter(new OpencodeSdkAdapter());
    const originalStartSession = adapter.startSession;
    let startInput: unknown;
    adapter.startSession = async (input) => {
      startInput = input;
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "session-normalized",
        startedAt: "2026-02-22T08:00:10.000Z",
        sessionAssociation: input.sessionScope,
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

  test("dedupes matching in-flight fresh starts", async () => {
    const startEntered = createDeferred<void>();
    const releaseStart = createDeferred<void>();
    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    let startCount = 0;
    adapter.startSession = async (input) => {
      startCount += 1;
      startEntered.resolve();
      await releaseStart.promise;
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "session-manual-fresh",
        startedAt: "2026-08-31T10:00:00.000Z",
        sessionAssociation: input.sessionScope,
        status: "idle",
      };
    };
    const { start } = createStartSessionTestHarness({
      adapter,
      taskRef: { current: [taskFixture] },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
      }),
    });

    try {
      const firstStart = start({
        taskId: "task-1",
        role: "build",
        startMode: "fresh",
        selectedModel: BUILD_SELECTION,
      });
      await startEntered.promise;
      const secondStart = start({
        taskId: "task-1",
        role: "build",
        startMode: "fresh",
        selectedModel: BUILD_SELECTION,
      });
      releaseStart.resolve();

      const [firstSession, secondSession] = await Promise.all([firstStart, secondStart]);
      expect(startCount).toBe(1);
      expect(firstSession).toEqual(secondSession);
    } finally {
      releaseStart.resolve();
      adapter.startSession = originalStartSession;
    }
  });

  test("serializes fresh starts across roles for the same task", async () => {
    const releaseQaStart = createDeferred<void>();
    const startedRoles: string[] = [];
    const qaStarted = createDeferred<void>();
    const buildStarted = createDeferred<void>();

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => {
      if (input.sessionScope.kind !== "workflow") {
        throw new Error("Expected workflow session scope.");
      }
      startedRoles.push(input.sessionScope.role);
      if (input.sessionScope.role === "qa") {
        qaStarted.resolve();
        await releaseQaStart.promise;
      } else {
        buildStarted.resolve();
      }
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: `${input.sessionScope.role}-external`,
        startedAt: "2026-02-22T08:00:10.000Z",
        sessionAssociation: input.sessionScope,
        status: "idle",
      };
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { start } = createStartSessionTestHarness({
      adapter,
      taskRef: {
        current: [
          {
            ...taskFixture,
            status: "ai_review",
            aiReviewEnabled: true,
            agentWorkflows: {
              ...taskFixture.agentWorkflows,
              qa: { ...taskFixture.agentWorkflows.qa, required: true, available: true },
            },
          },
        ],
      },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      const qaPromise = start({
        taskId: "task-1",
        role: "qa",
        startMode: "fresh",
        selectedModel: QA_SELECTION,
        queueIfBusy: true,
      });
      await qaStarted.promise;
      const buildPromise = start({
        taskId: "task-1",
        role: "build",
        startMode: "fresh",
        selectedModel: BUILD_SELECTION,
      });

      expect(await withTimeout(buildStarted.promise, 25)).toBe("timeout");
      expect(startedRoles).toEqual(["qa"]);

      releaseQaStart.resolve();
      await buildStarted.promise;
      await expect(qaPromise).resolves.toEqual(
        expect.objectContaining({ externalSessionId: "qa-external" }),
      );
      await expect(buildPromise).resolves.toEqual(
        expect.objectContaining({ externalSessionId: "build-external" }),
      );
      expect(startedRoles).toEqual(["qa", "build"]);
    } finally {
      releaseQaStart.resolve();
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

  test("waits for the host-controlled session start before resolving", async () => {
    const startDeferred = createDeferred<AgentSessionSummary>();
    let sessionCollection: AgentSessionCollection = emptyAgentSessionCollection();
    const sessionsRef = { current: sessionCollection };
    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async () => startDeferred.promise;

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
    });

    try {
      const startPromise = start({
        taskId: "task-1",
        role: "planner",
        startMode: "fresh",
        selectedModel: PLANNER_SELECTION,
        holdForPostStartMessage: true,
      });

      await expect(withTimeout(startPromise, 25)).resolves.toBe("timeout");
      expect(listAgentSessions(sessionCollection)).toHaveLength(0);

      startDeferred.resolve({
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
        externalSessionId: "planner-external",
        startedAt: "2026-02-22T08:00:10.000Z",
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "planner" },
        status: "idle",
      });

      await expect(startPromise).resolves.toEqual(
        expect.objectContaining({ externalSessionId: "planner-external" }),
      );
      expect(listAgentSessions(sessionCollection)).toHaveLength(1);
      expect(listAgentSessions(sessionCollection)[0]?.status).toBe("starting");
    } finally {
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
      sessionAssociation: input.sessionScope,
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
      expect(getSession(sessionCollection, "planner-external")?.historyLoadState).toBe("loaded");
      expect(lifecycleEvents).not.toContain("status:idle");
    } finally {
      adapter.startSession = originalStartSession;
    }
  });

  test("publishes message-first starts after the host-controlled start finishes", async () => {
    const startDeferred = createDeferred<AgentSessionSummary>();
    const sessionStore = createAgentSessionsStore("/tmp/repo");
    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async () => startDeferred.promise;

    const { start } = createStartSessionTestHarness({
      adapter,
      replaceSession: sessionStore.replaceSession,
      readSessionSnapshot: sessionStore.getSessionSnapshot,
      taskRef: { current: [taskFixture] },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      const startPromise = start({
        taskId: "task-1",
        role: "planner",
        startMode: "fresh",
        selectedModel: PLANNER_SELECTION,
        holdForPostStartMessage: true,
      });

      await expect(withTimeout(startPromise, 25)).resolves.toBe("timeout");
      expect(sessionStore.getActivitySnapshot().sessions).toEqual([]);

      startDeferred.resolve({
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
        externalSessionId: "message-first-session",
        startedAt: "2026-02-22T08:00:10.000Z",
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "planner" },
        status: "idle",
      });
      await expect(startPromise).resolves.toEqual(
        expect.objectContaining({ externalSessionId: "message-first-session" }),
      );
      expect(sessionStore.getActivitySnapshot().sessions).toEqual([
        expect.objectContaining({
          externalSessionId: "message-first-session",
          activityState: "starting",
        }),
      ]);
    } finally {
      adapter.startSession = originalStartSession;
    }
  });

  test("does not attach a session when the host-controlled start fails", async () => {
    const sessionsRef = { current: emptyAgentSessionCollection() };
    const adapter = new OpencodeSdkAdapter();
    adapter.startSession = async () => {
      throw new Error("persist failed");
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
    });

    await expect(
      start({
        taskId: "task-1",
        role: "planner",
        startMode: "fresh",
        selectedModel: PLANNER_SELECTION,
      }),
    ).rejects.toThrow("persist failed");

    expect(listAgentSessions(sessionsRef.current)).toHaveLength(0);
  });

  test("keeps the stored session when bootstrap completion fails", async () => {
    const sessionsRef = { current: emptyAgentSessionCollection() };
    let abortCalls = 0;
    let stopCalls = 0;
    const adapter = new OpencodeSdkAdapter();
    adapter.startSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "external-bootstrap-fail",
      sessionAssociation: input.sessionScope,
      status: "running",
      startedAt: "2026-02-22T08:00:00.000Z",
    });
    adapter.stopSession = async () => {
      stopCalls += 1;
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
    expect(abortCalls).toBe(0);
    expect(getSession(sessionsRef.current, "external-bootstrap-fail")?.status).toBe("stopped");
  });

  test("keeps the host-stored session attached when rollback cannot stop it", async () => {
    const sessionsRef = { current: emptyAgentSessionCollection() };
    let abortCalls = 0;
    const adapter = new OpencodeSdkAdapter();
    adapter.startSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "external-stop-fail",
      sessionAssociation: input.sessionScope,
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
    expect(abortCalls).toBe(0);
  });

  test("keeps worktree resources un-aborted when registration cleanup cannot stop the runtime", async () => {
    const sessionsRef = { current: emptyAgentSessionCollection() };
    let abortCalls = 0;
    const adapter = new OpencodeSdkAdapter();
    adapter.startSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "external-registration-stop-fail",
      sessionAssociation: input.sessionScope,
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
          complete: async () => {},
          abort: async () => {
            abortCalls += 1;
          },
        },
      }),
      replaceSession: () => {
        throw new Error("registration failed");
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
      'Failed to attach stored session "external-registration-stop-fail" to task "task-1": registration failed. Failed to stop the started session during rollback: runtime unavailable. Cleanup was not continued.',
    );
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
        sessionAssociation: input.sessionScope,
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
      "Workspace changed while starting session. Failed to stop the started session during rollback: runtime unavailable. Cleanup was not continued.",
    );
    expect(abortCalls).toBe(0);
  });

  test("keeps the stored session and completes bootstrap when the repository changes before attach", async () => {
    const sessionsRef = { current: emptyAgentSessionCollection() };
    const repoEpochRef = { current: 1 };
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" };
    let completeCalls = 0;
    let abortCalls = 0;
    const adapter = new OpencodeSdkAdapter();
    adapter.startSession = async (input) => {
      repoEpochRef.current += 1;
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "external-falsy-rollback-errors",
        sessionAssociation: input.sessionScope,
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
      };
    };
    adapter.stopSession = async () => {};

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
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
    });

    await expect(
      start({
        taskId: "task-1",
        role: "planner",
        startMode: "fresh",
        selectedModel: PLANNER_SELECTION,
      }),
    ).rejects.toThrow("The stored task session was kept.");
    expect(completeCalls).toBe(1);
    expect(abortCalls).toBe(0);
    expect(getSession(sessionsRef.current, "external-falsy-rollback-errors")).toBeUndefined();
  });

  test("stops and keeps a fresh non-Builder session when the repository changes after bootstrap commits", async () => {
    const completionStarted = createDeferred<void>();
    const completion = createDeferred<void>();
    const repoEpochRef = { current: 1 };
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" };
    const sessionsRef = { current: emptyAgentSessionCollection() };
    let abortCalls = 0;
    let stopCalls = 0;
    const adapter = new OpencodeSdkAdapter();
    adapter.startSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "external-stale-bootstrap",
      sessionAssociation: input.sessionScope,
      status: "running",
      startedAt: "2026-02-22T08:00:00.000Z",
    });
    adapter.stopSession = async () => {
      stopCalls += 1;
    };

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef,
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
    expect(stopCalls).toBe(1);
    expect(abortCalls).toBe(0);
    expect(getSession(sessionsRef.current, "external-stale-bootstrap")).toBeDefined();
  });

  test("stops and keeps a fresh Builder session when the repository changes after bootstrap commits", async () => {
    const completionStarted = createDeferred<void>();
    const completion = createDeferred<void>();
    const repoEpochRef = { current: 1 };
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" };
    const sessionsRef = { current: emptyAgentSessionCollection() };
    let abortCalls = 0;
    let stopCalls = 0;
    const adapter = new OpencodeSdkAdapter();
    adapter.startSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "external-committed-builder",
      sessionAssociation: input.sessionScope,
      status: "running",
      startedAt: "2026-02-22T08:00:00.000Z",
    });
    adapter.stopSession = async () => {
      stopCalls += 1;
    };

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef,
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
    expect(stopCalls).toBe(1);
    expect(abortCalls).toBe(0);
    expect(getSession(sessionsRef.current, "external-committed-builder")).toBeDefined();
  });

  test("clears session observation state when bootstrap completion fails", async () => {
    const clearedIdentities: AgentSessionIdentity[] = [];
    const adapter = new OpencodeSdkAdapter();
    adapter.startSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "external-bootstrap-fail",
      sessionAssociation: input.sessionScope,
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

  test("does not retry failed bootstrap completion", async () => {
    const sessionsRef = { current: emptyAgentSessionCollection() };
    let completeCalls = 0;
    let abortCalls = 0;
    const adapter = new OpencodeSdkAdapter();
    adapter.startSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "external-bootstrap-delete-fail",
      sessionAssociation: input.sessionScope,
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
    });

    await expect(
      start({
        taskId: "task-1",
        role: "planner",
        startMode: "fresh",
        selectedModel: PLANNER_SELECTION,
      }),
    ).rejects.toThrow("bootstrap completion failed");
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
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("lets host bootstrap resolve the canonical worktree for qa start", async () => {
    const ensuredWorkingDirectories: Array<string | null | undefined> = [];
    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => ({
      externalSessionId: "external-qa",
      workingDirectory: input.workingDirectory,
      sessionAssociation: input.sessionScope,
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
      expect(ensuredWorkingDirectories).toEqual([undefined]);
    } finally {
      adapter.startSession = originalStartSession;
    }
  });

  test("creates a fresh session without sending a kickoff", async () => {
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
        sessionAssociation: input.sessionScope,
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
      expect(kickoffCalls).toBe(0);
      expect(refreshCalls).toBe(0);
      expect(getSession(sessionsRef.current, "external-created")).toBeDefined();
      const createdSession = getSession(sessionsRef.current, "external-created");
      expect(createdSession).toBeDefined();
      expect(createdSession?.historyLoadState).toBe("loaded");
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

      const adapter = new OpencodeSdkAdapter();
      const originalStartSession = adapter.startSession;
      adapter.startSession = async () => {
        startCalls += 1;
        throw new Error("startSession should not be reached");
      };

      // @ts-expect-error -- This case verifies that a fresh session rejects a missing or blank runtime kind.
      const selectedModel: AgentModelSelection = (() => {
        if (runtimeKind === undefined) {
          const { runtimeKind: _runtimeKind, ...selectionWithoutRuntime } = BUILD_SELECTION;
          return selectionWithoutRuntime;
        }
        return {
          ...BUILD_SELECTION,
          runtimeKind,
        };
      })();

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
      });

      try {
        const expectedError = runtimeKind
          ? `Unsupported runtime kind '${runtimeKind}'.`
          : "Runtime kind is required to start a session. Select an explicit runtime before starting.";

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
    let observedStartInput: Parameters<OpencodeSdkAdapter["startSession"]>[0] | null = null;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => {
      observedStartInput = input;
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "external-created",
        startedAt: "2026-02-22T08:00:10.000Z",
        sessionAssociation: input.sessionScope,
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
