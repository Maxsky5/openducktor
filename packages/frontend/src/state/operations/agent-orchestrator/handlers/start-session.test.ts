import { beforeEach, describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type {
  AgentSessionControlSummary,
  AgentWorkflowSessionStartInput,
} from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
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
  workflowSessionStartSummary,
} from "./start-session.test-helpers";

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
    let startInput: unknown;
    const { start } = createStartSessionTestHarness({
      taskRef: { current: [taskFixture] },
      startWorkflowSession: async (input) => {
        startInput = input;
        return workflowSessionStartSummary(input, {
          externalSessionId: "session-normalized",
        });
      },
      loadSettingsSnapshot: async () => {
        throw new Error("session control must not load runtime policy settings");
      },
    });

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
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
    });
    expect(startInput).not.toHaveProperty("runtimePolicy");
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
    let startCount = 0;
    const { start } = createStartSessionTestHarness({
      taskRef: { current: [taskFixture] },
      startWorkflowSession: async (input) => {
        startCount += 1;
        startEntered.resolve();
        await releaseStart.promise;
        return workflowSessionStartSummary(input, {
          externalSessionId: "session-manual-fresh",
        });
      },
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
    }
  });

  test("serializes fresh starts across roles for the same task", async () => {
    const releaseQaStart = createDeferred<void>();
    const startedRoles: string[] = [];
    const qaStarted = createDeferred<void>();
    const buildStarted = createDeferred<void>();

    const startWorkflowSession = async (input: AgentWorkflowSessionStartInput) => {
      startedRoles.push(input.sessionScope.role);
      if (input.sessionScope.role === "qa") {
        qaStarted.resolve();
        await releaseQaStart.promise;
      } else {
        buildStarted.resolve();
      }
      return workflowSessionStartSummary(input, {
        externalSessionId: `${input.sessionScope.role}-external`,
      });
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { start } = createStartSessionTestHarness({
      startWorkflowSession,
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
    const startDeferred = createDeferred<AgentSessionControlSummary>();
    let sessionCollection: AgentSessionCollection = emptyAgentSessionCollection();
    const sessionsRef = { current: sessionCollection };
    const { start } = createStartSessionTestHarness({
      startWorkflowSession: async () => startDeferred.promise,
      onSessionCollectionChange: (collection) => {
        sessionCollection = collection;
      },
      sessionsRef,
      taskRef: { current: [taskFixture] },
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
        status: "idle",
      });

      await expect(startPromise).resolves.toEqual(
        expect.objectContaining({ externalSessionId: "planner-external" }),
      );
      expect(listAgentSessions(sessionCollection)).toHaveLength(1);
      expect(listAgentSessions(sessionCollection)[0]?.status).toBe("starting");
    } finally {
      startDeferred.reject(new Error("test cleanup"));
    }
  });

  test("keeps held fresh sessions starting after local registration", async () => {
    let sessionCollection: AgentSessionCollection = emptyAgentSessionCollection();
    const lifecycleEvents: string[] = [];
    const sessionsRef = { current: sessionCollection };
    const { start } = createStartSessionTestHarness({
      startWorkflowSession: async (input) =>
        workflowSessionStartSummary(input, { externalSessionId: "planner-external" }),
      onSessionCollectionChange: (collection) => {
        sessionCollection = collection;
        lifecycleEvents.push(
          `status:${getSession(sessionCollection, "planner-external")?.status ?? "missing"}`,
        );
      },
      sessionsRef,
      taskRef: { current: [taskFixture] },
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
      sessionsRef.current = emptyAgentSessionCollection();
    }
  });

  test("publishes message-first starts after the host-controlled start finishes", async () => {
    const startDeferred = createDeferred<AgentSessionControlSummary>();
    const sessionStore = createAgentSessionsStore("/tmp/repo");
    const { start } = createStartSessionTestHarness({
      startWorkflowSession: async () => startDeferred.promise,
      replaceSession: sessionStore.replaceSession,
      readSessionSnapshot: sessionStore.getSessionSnapshot,
      taskRef: { current: [taskFixture] },
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
      startDeferred.reject(new Error("test cleanup"));
    }
  });

  test("does not attach a session when the host-controlled start fails", async () => {
    const sessionsRef = { current: emptyAgentSessionCollection() };
    const { start } = createStartSessionTestHarness({
      sessionsRef,
      taskRef: { current: [{ ...taskFixture, id: "task-1" }] },
      startWorkflowSession: async () => {
        throw new Error("persist failed");
      },
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

  test("does not continue registration cleanup when the runtime stop fails", async () => {
    const sessionsRef = { current: emptyAgentSessionCollection() };
    const adapter = new OpencodeSdkAdapter();
    adapter.stopSession = async () => {
      throw new Error("runtime unavailable");
    };

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef,
      taskRef: { current: [{ ...taskFixture, id: "task-1" }] },
      startWorkflowSession: async (input) =>
        workflowSessionStartSummary(input, {
          externalSessionId: "external-registration-stop-fail",
          status: "running",
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
  });

  test("does not continue stale-session cleanup when the runtime stop fails", async () => {
    const repoEpochRef = { current: 1 };
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" };
    const adapter = new OpencodeSdkAdapter();
    adapter.stopSession = async () => {
      throw new Error("runtime unavailable");
    };

    const { start } = createStartSessionTestHarness({
      adapter,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
      taskRef: { current: [{ ...taskFixture, id: "task-1" }] },
      startWorkflowSession: async (input) => {
        repoEpochRef.current += 1;
        currentWorkspaceRepoPathRef.current = "/tmp/other-repo";
        return workflowSessionStartSummary(input, {
          externalSessionId: "external-stale-stop-fail",
          status: "running",
        });
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
      "Workspace changed while starting session. Failed to stop the started session during rollback: runtime unavailable. Cleanup was not continued.",
    );
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
      startWorkflowSession: async (input) => {
        runtimeCalls += 1;
        return workflowSessionStartSummary(input);
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

  test("lets the host resolve the canonical worktree for qa start", async () => {
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
      startWorkflowSession: async (input) => {
        ensuredWorkingDirectories.push(input.targetWorkingDirectory);
        return workflowSessionStartSummary(input, { externalSessionId: "external-qa" });
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

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { sessionsRef, start } = createStartSessionTestHarness({
      taskRef: { current: [taskFixture] },
      startWorkflowSession: async (input) => {
        startCalls += 1;
        return workflowSessionStartSummary(input, {
          externalSessionId: "external-created",
          startedAt: "2026-02-22T08:00:10.000Z",
        });
      },
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
      expect(refreshCalls).toBe(1);
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
      startWorkflowSession: async (input) => {
        runtimeCalls += 1;
        return workflowSessionStartSummary(input);
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
        startWorkflowSession: async (input) => {
          runtimeCalls += 1;
          return workflowSessionStartSummary(input);
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
    let observedStartInput: AgentWorkflowSessionStartInput | null = null;

    const startWorkflowSession = async (input: AgentWorkflowSessionStartInput) => {
      observedStartInput = input;
      return workflowSessionStartSummary(input, { externalSessionId: "external-created" });
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { start } = createStartSessionTestHarness({
      startWorkflowSession,
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
        throw new Error("Expected startWorkflowSession to receive input.");
      }
      expect(observedStartInput).toMatchObject({ model: selectedModel });
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });
});
