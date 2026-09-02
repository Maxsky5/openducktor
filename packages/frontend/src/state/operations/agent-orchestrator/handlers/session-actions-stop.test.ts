import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { SessionRef } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import {
  findSessionMessageForTest,
  lastSessionMessageForTest,
} from "@/test-utils/session-message-test-helpers";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { listenToAgentSessionEvents } from "../events/session-events-test-harness";
import { createSessionTurnMetadata } from "../support/session-turn-metadata";
import { createDeferred, createTaskCardFixture } from "../test-utils";
import {
  buildSession,
  createSessionActions,
  createSessionsRef,
  createSessionTurnStateFixture,
  getSession,
} from "./session-actions.test-helpers";
describe("agent-orchestrator/handlers/session-actions stop", () => {
  test("stops a workspace-scoped planner session and clears pending state", async () => {
    const adapter = new OpencodeSdkAdapter();
    const stopTargets: SessionRef[] = [];
    adapter.stopSession = async (target) => {
      stopTargets.push(target);
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "planner" },
        workingDirectory: "/tmp/repo",
        runtimeStatusMessage: "Safety buffering",
        pendingApprovals: [
          {
            requestId: "perm-1",
            requestType: "permission_grant" as const,
            title: `Approve permission: ${"read"}`,
            summary: `Approval request for ${"read"}.`,
            affectedPaths: ["*"],
            action: { name: "read" },
            mutation: "read_only" as const,
            supportedReplyOutcomes: [
              "approve_once" as const,
              "approve_session" as const,
              "reject" as const,
            ],
          },
        ],
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [
              {
                header: "Confirm",
                question: "Confirm",
                options: [],
                multiple: false,
                custom: false,
              },
            ],
          },
        ],
      }),
    ]);
    const actions = createSessionActions({
      adapter,
      sessionsRef,
    });

    await actions.stopAgentSession(getSession(sessionsRef));
    expect(stopTargets).toEqual([
      {
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
        externalSessionId: "session-1",
      },
    ]);
    expect(getSession(sessionsRef)?.status).toBe("stopped");
    expect(getSession(sessionsRef)?.runtimeStatusMessage).toBeNull();
    expect(getSession(sessionsRef)?.pendingApprovals).toHaveLength(0);
    expect(getSession(sessionsRef)?.pendingQuestions).toHaveLength(0);
  });

  test("keeps session active when authoritative session stop fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalStopSession = adapter.stopSession;
    let localStopCalls = 0;
    adapter.stopSession = async () => {
      localStopCalls += 1;
      throw new Error("build stop failed");
    };
    const sessionsRef = createSessionsRef([
      buildSession({
        pendingApprovals: [
          {
            requestId: "perm-1",
            requestType: "permission_grant" as const,
            title: `Approve permission: ${"read"}`,
            summary: `Approval request for ${"read"}.`,
            affectedPaths: ["*"],
            action: { name: "read" },
            mutation: "read_only" as const,
            supportedReplyOutcomes: [
              "approve_once" as const,
              "approve_session" as const,
              "reject" as const,
            ],
          },
        ],
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [
              {
                header: "Confirm",
                question: "Confirm",
                options: [],
                multiple: false,
                custom: false,
              },
            ],
          },
        ],
      }),
    ]);
    const sessionKey = agentSessionIdentityKey(getSession(sessionsRef));
    const sessionTurnState = createSessionTurnStateFixture();
    sessionTurnState.turnMetadata.recordModel(sessionKey, null);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionTurnState: sessionTurnState.sessionTurnState,
    });

    try {
      await expect(actions.stopAgentSession(getSession(sessionsRef))).rejects.toThrow(
        "Failed to stop session 'session-1': build stop failed",
      );
      expect(localStopCalls).toBe(1);
      expect(sessionTurnState.turnMetadata.readModel(sessionKey)).toBeNull();
      expect(getSession(sessionsRef)?.status).toBe("running");
      expect(getSession(sessionsRef)?.stopRequestedAt).toBeNull();
      expect(getSession(sessionsRef)?.pendingApprovals).toHaveLength(1);
      expect(getSession(sessionsRef)?.pendingQuestions).toHaveLength(1);
    } finally {
      adapter.stopSession = originalStopSession;
    }
  });

  test("keeps terminal event state when the host stop later fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const session = buildSession();
    const sessionsRef = createSessionsRef([session]);
    const sessionsStore = createAgentSessionsStore("/tmp/repo");
    sessionsStore.replaceSession(session);
    adapter.stopSession = async () => {
      sessionsStore.updateSession(session, (current) => ({
        ...current,
        status: "stopped",
        stopRequestedAt: null,
      }));
      throw new Error("stop failed after terminal event");
    };
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      readSessionSnapshot: sessionsStore.getSessionSnapshot,
      updateSession: sessionsStore.updateSession,
    });

    await expect(actions.stopAgentSession(session)).rejects.toThrow(
      "Failed to stop session 'session-1': stop failed after terminal event",
    );

    expect(sessionsStore.getSessionSnapshot(session)?.status).toBe("stopped");
  });

  test("records stop intent before awaiting authoritative session stop", async () => {
    const adapter = new OpencodeSdkAdapter();
    const stopDeferred = createDeferred<void>();
    adapter.stopSession = async () => {
      await stopDeferred.promise;
    };
    const sessionsRef = createSessionsRef([
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
      }),
    ]);
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
    });

    const stopPromise = actions.stopAgentSession(getSession(sessionsRef));
    await Promise.resolve();

    expect(getSession(sessionsRef)?.stopRequestedAt).toBeString();
    expect(getSession(sessionsRef)?.status).toBe("running");

    stopDeferred.resolve();
    await stopPromise;

    expect(getSession(sessionsRef)?.stopRequestedAt).toBeNull();
    expect(getSession(sessionsRef)?.status).toBe("stopped");
  });

  test("preserves the user-stopped notice when local stop emits session_finished", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSubscribeEvents = adapter.subscribeEvents;
    const originalStopSession = adapter.stopSession;
    let sessionEventListener: Parameters<OpencodeSdkAdapter["subscribeEvents"]>[1] | null = null;
    adapter.subscribeEvents = async (_externalSessionId, listener) => {
      sessionEventListener = listener;
      return () => {
        sessionEventListener = null;
      };
    };

    const session = buildSession({
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
      messages: [
        {
          id: "tool-running",
          role: "tool",
          content: "Tool todowrite running...",
          timestamp: "2026-02-22T08:00:08.000Z",
          meta: {
            kind: "tool",
            partId: "part-tool-running",
            callId: "call-tool-running",
            tool: "todowrite",
            toolType: "todo",
            status: "running",
          },
        },
      ],
      pendingApprovals: [
        {
          requestId: "perm-1",
          requestType: "permission_grant" as const,
          title: `Approve permission: ${"read"}`,
          summary: `Approval request for ${"read"}.`,
          affectedPaths: ["*"],
          action: { name: "read" },
          mutation: "read_only" as const,
          supportedReplyOutcomes: [
            "approve_once" as const,
            "approve_session" as const,
            "reject" as const,
          ],
        },
      ],
    });
    const sessionsRef = createSessionsRef([session]);
    const sessionsStore = createAgentSessionsStore("/tmp/repo");
    sessionsStore.replaceSession(session);
    const updateSession = (
      identity: AgentSessionIdentity,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => sessionsStore.updateSession(identity, updater);

    const unsubscribe = await listenToAgentSessionEvents({
      adapter,
      sessionsRef,
      sessionRef: {
        externalSessionId: "session-1",
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
        runtimePolicy: { kind: "opencode" },
      },
      turnMetadata: createSessionTurnMetadata(),
      readSession: sessionsStore.getSessionSnapshot,
      ensureSession: (identity, createSession) => {
        const current = sessionsStore.getSessionSnapshot(identity);
        if (current) {
          return current;
        }
        const nextSession = createSession();
        sessionsStore.replaceSession(nextSession);
        return nextSession;
      },
      updateSession,
      updateSessionTodos: () => {},
      isSessionObserved: (identity) => identity.externalSessionId === "session-1",
      buildReadOnlyApprovalRejectionMessage: async () => "Rejected by read-only policy.",
      recordTurnActivityTimestamp: () => {},
      recordTurnUserMessageTimestamp: () => {},
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      readOnlyApprovalAutoRejectSafe: false,
    });

    adapter.stopSession = async (sessionRef) => {
      sessionEventListener?.({
        type: "session_finished",
        externalSessionId: sessionRef.externalSessionId,
        timestamp: "2026-02-22T08:00:10.000Z",
        message: "Session stopped",
      });
    };

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      readSessionSnapshot: sessionsStore.getSessionSnapshot,
      updateSession,
    });

    try {
      await actions.stopAgentSession(session);

      const stoppedSession = sessionsStore.getSessionSnapshot(session);
      if (!stoppedSession) {
        throw new Error("Expected stopped session");
      }
      const lastMessage = lastSessionMessageForTest(stoppedSession);
      expect(lastMessage?.content).toBe("Session stopped at your request.");
      expect(lastMessage?.meta).toEqual({
        kind: "session_notice",
        tone: "cancelled",
        reason: "user_stopped",
        title: "Stopped",
      });
      const toolMessage = findSessionMessageForTest(
        stoppedSession,
        (message) => message.id === "tool-running",
      );
      expect(toolMessage?.meta?.kind).toBe("tool");
      if (toolMessage?.meta?.kind !== "tool") {
        throw new Error("Expected tool metadata");
      }
      expect(toolMessage.meta.status).toBe("error");
      expect(toolMessage.meta.error).toBe("Session stopped at your request.");
      expect(stoppedSession.status).toBe("stopped");
      expect(stoppedSession.stopRequestedAt).toBeNull();
    } finally {
      adapter.subscribeEvents = originalSubscribeEvents;
      adapter.stopSession = originalStopSession;
      unsubscribe();
    }
  });

  test("appends the user-stopped notice when authoritative stop has no local runtime event", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalStopSession = adapter.stopSession;
    let localStopCalls = 0;
    adapter.stopSession = async () => {
      localStopCalls += 1;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        runtimeKind: "codex",
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        messages: [
          {
            id: "tool-running",
            role: "tool",
            content: "Tool todowrite running...",
            timestamp: "2026-02-22T08:00:08.000Z",
            meta: {
              kind: "tool",
              partId: "part-tool-running",
              callId: "call-tool-running",
              tool: "todowrite",
              toolType: "todo",
              status: "running",
            },
          },
        ],
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
    });

    try {
      await actions.stopAgentSession(getSession(sessionsRef));

      expect(localStopCalls).toBe(1);
      const lastMessage = lastSessionMessageForTest(getSession(sessionsRef));
      expect(lastMessage?.content).toBe("Session stopped at your request.");
      expect(lastMessage?.meta).toEqual({
        kind: "session_notice",
        tone: "cancelled",
        reason: "user_stopped",
        title: "Stopped",
      });
      const toolMessage = findSessionMessageForTest(
        getSession(sessionsRef),
        (message) => message.id === "tool-running",
      );
      expect(toolMessage?.meta?.kind).toBe("tool");
      if (toolMessage?.meta?.kind !== "tool") {
        throw new Error("Expected tool metadata");
      }
      expect(toolMessage.meta.status).toBe("error");
      expect(toolMessage.meta.error).toBe("Session stopped at your request.");
      expect(getSession(sessionsRef)?.status).toBe("stopped");
      expect(getSession(sessionsRef)?.stopRequestedAt).toBeNull();
    } finally {
      adapter.stopSession = originalStopSession;
    }
  });

  test("clears renderer turn state after the host stop succeeds", async () => {
    const adapter = new OpencodeSdkAdapter();
    const callOrder: string[] = [];
    adapter.stopSession = async () => {
      callOrder.push("host-stop");
    };

    const sessionsRef = createSessionsRef([buildSession()]);
    const sessionKey = agentSessionIdentityKey(getSession(sessionsRef));
    const sessionTurnState = createSessionTurnStateFixture();
    sessionTurnState.assistantTurnTiming.recordTurnUserMessageTimestamp(sessionKey, 1);
    sessionTurnState.turnMetadata.recordModel(sessionKey, null);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionTurnState: sessionTurnState.sessionTurnState,
    });

    await expect(actions.stopAgentSession(getSession(sessionsRef))).resolves.toBeUndefined();
    expect(callOrder).toEqual(["host-stop"]);
    expect(
      sessionTurnState.assistantTurnTiming.readTurnUserMessageStartedAtMs(sessionKey),
    ).toBeUndefined();
    expect(sessionTurnState.turnMetadata.readModel(sessionKey)).toBeUndefined();
    expect(getSession(sessionsRef)?.status).toBe("stopped");
  });

  test("stops shared-runtime qa sessions authoritatively without runId", async () => {
    const adapter = new OpencodeSdkAdapter();
    let buildStopCalls = 0;
    adapter.stopSession = async (target) => {
      buildStopCalls += 1;
      expect(target).toEqual({
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        externalSessionId: "session-1",
      });
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "qa" },
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
    });

    await actions.stopAgentSession(getSession(sessionsRef));
    expect(buildStopCalls).toBe(1);
    expect(getSession(sessionsRef)?.status).toBe("stopped");
  });

  test("refreshes task-owned state after the host stops the session", async () => {
    const adapter = new OpencodeSdkAdapter();

    const callOrder: string[] = [];
    adapter.stopSession = async () => {
      callOrder.push("stop-authoritative-session");
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        pendingApprovals: [
          {
            requestId: "perm-1",
            requestType: "permission_grant" as const,
            title: `Approve permission: ${"read"}`,
            summary: `Approval request for ${"read"}.`,
            affectedPaths: ["*"],
            action: { name: "read" },
            mutation: "read_only" as const,
            supportedReplyOutcomes: [
              "approve_once" as const,
              "approve_session" as const,
              "reject" as const,
            ],
          },
        ],
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [
              {
                header: "Proceed",
                question: "Proceed?",
                options: [],
                multiple: false,
                custom: false,
              },
            ],
          },
        ],
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      loadSourceSession: async () => {
        callOrder.push("force-read-model-refresh");
        return null;
      },
      refreshTaskData: async () => {
        callOrder.push("refresh-task-data");
      },
      invalidateSessionStopQueries: async () => {
        callOrder.push("invalidate-stop-queries");
      },
    });

    const stopPromise = actions.stopAgentSession(getSession(sessionsRef));
    await Promise.resolve();

    expect(callOrder).toContain("stop-authoritative-session");
    expect(callOrder).not.toContain("force-read-model-refresh");

    await stopPromise;

    expect(callOrder).toContain("invalidate-stop-queries");
    expect(callOrder).toContain("refresh-task-data");
    expect(callOrder).not.toContain("force-read-model-refresh");
    expect(getSession(sessionsRef)?.status).toBe("stopped");
    expect(getSession(sessionsRef)?.pendingApprovals).toHaveLength(0);
    expect(getSession(sessionsRef)?.pendingQuestions).toHaveLength(0);
  });

  test("refreshes task-owned state after successful authoritative stop", async () => {
    const adapter = new OpencodeSdkAdapter();
    const refreshTaskDataCalls: Array<[string, string | string[] | undefined]> = [];
    let loadSourceSessionCalls = 0;
    let stopCalls = 0;
    const invalidationCalls: Array<{ repoPath: string; taskId: string; runtimeKind?: string }> = [];

    adapter.stopSession = async () => {
      stopCalls += 1;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        runtimeKind: "opencode",
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      loadSourceSession: async () => {
        loadSourceSessionCalls += 1;
        return null;
      },
      refreshTaskData: async (repoPath, taskIdOrIds) => {
        refreshTaskDataCalls.push([repoPath, taskIdOrIds]);
      },
      invalidateSessionStopQueries: async (input) => {
        invalidationCalls.push(input);
      },
    });

    await actions.stopAgentSession(getSession(sessionsRef));
    expect(stopCalls).toBe(1);
    expect(refreshTaskDataCalls).toEqual([["/tmp/repo", "task-1"]]);
    expect(loadSourceSessionCalls).toBe(0);
    expect(invalidationCalls).toEqual([
      {
        repoPath: "/tmp/repo",
        taskId: "task-1",
      },
    ]);
  });

  test("does not refresh task state for a repository session", async () => {
    const adapter = new OpencodeSdkAdapter();
    const stopTargets: SessionRef[] = [];
    adapter.stopSession = async (target) => {
      stopTargets.push(target);
    };
    const taskCalls: string[] = [];
    const sessionsRef = createSessionsRef([
      buildSession({
        sessionAssociation: { kind: "repository" },
      }),
    ]);
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      workspaceRepoPath: "/tmp/active-workspace",
      refreshTaskData: async () => {
        taskCalls.push("refresh");
      },
      invalidateSessionStopQueries: async () => {
        taskCalls.push("invalidate");
      },
    });

    await actions.stopAgentSession(getSession(sessionsRef));

    expect(getSession(sessionsRef)?.status).toBe("stopped");
    expect(stopTargets).toEqual([
      {
        repoPath: "/tmp/active-workspace",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        externalSessionId: "session-1",
      },
    ]);
    expect(taskCalls).toEqual([]);
  });

  test("stops an unbound live session without task side effects", async () => {
    const adapter = new OpencodeSdkAdapter();
    const stopTargets: SessionRef[] = [];
    adapter.stopSession = async (target) => {
      stopTargets.push(target);
    };
    const taskCalls: string[] = [];
    const sessionsRef = createSessionsRef([
      buildSession({
        sessionAssociation: { kind: "unbound" },
        workingDirectory: "/tmp/repo/unbound-chat",
      }),
    ]);
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      refreshTaskData: async () => {
        taskCalls.push("refresh");
      },
      invalidateSessionStopQueries: async () => {
        taskCalls.push("invalidate");
      },
    });

    await actions.stopAgentSession(getSession(sessionsRef));

    expect(stopTargets).toEqual([
      {
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/unbound-chat",
        externalSessionId: "session-1",
      },
    ]);
    expect(getSession(sessionsRef).status).toBe("stopped");
    expect(taskCalls).toEqual([]);
  });

  test("rejects a missing association before stopping the runtime", async () => {
    const adapter = new OpencodeSdkAdapter();
    let stopCalls = 0;
    adapter.stopSession = async () => {
      stopCalls += 1;
    };
    const malformedSession = buildSession();
    Reflect.deleteProperty(malformedSession, "sessionAssociation");
    const sessionsRef = createSessionsRef([malformedSession]);
    const actions = createSessionActions({ adapter, sessionsRef });

    await expect(actions.stopAgentSession(getSession(sessionsRef))).rejects.toThrow(
      "Cannot stop for session 'session-1' because its association is missing.",
    );
    expect(stopCalls).toBe(0);
  });

  test("reports workflow stop refresh failure", async () => {
    const adapter = new OpencodeSdkAdapter();
    adapter.stopSession = async () => {};
    const taskCalls: string[] = [];
    const sessionsRef = createSessionsRef([buildSession()]);
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      refreshTaskData: async () => {
        taskCalls.push("refresh");
      },
      invalidateSessionStopQueries: async () => {
        taskCalls.push("invalidate");
        throw new Error("stopped session refresh failed");
      },
    });

    await expect(actions.stopAgentSession(getSession(sessionsRef))).rejects.toThrow(
      "stopped session refresh failed",
    );

    expect(getSession(sessionsRef).status).toBe("stopped");
    expect(taskCalls).toContain("invalidate");
  });

  test("rejects stop without an active workspace", async () => {
    const adapter = new OpencodeSdkAdapter();
    const stopTargets: SessionRef[] = [];
    adapter.stopSession = async (target) => {
      stopTargets.push(target);
    };
    const sessionsRef = createSessionsRef([buildSession()]);

    const actions = createSessionActions({
      workspaceRepoPath: null,
      adapter,
      sessionsRef,
    });

    await expect(actions.stopAgentSession(getSession(sessionsRef))).rejects.toThrow(
      "Active workspace repo path is unavailable.",
    );
    expect(stopTargets).toEqual([]);
  });

  test("allows stopping a running session even when role is unavailable", async () => {
    const adapter = new OpencodeSdkAdapter();
    let stopCalls = 0;
    adapter.stopSession = async () => {
      stopCalls += 1;
    };
    const sessionsRef = createSessionsRef([
      buildSession({
        status: "running",
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: {
        current: [
          createTaskCardFixture({
            id: "task-1",
            status: "open",
            agentWorkflows: {
              spec: { required: true, canSkip: false, available: true, completed: false },
              planner: { required: true, canSkip: false, available: false, completed: false },
              builder: { required: true, canSkip: false, available: false, completed: false },
              qa: { required: true, canSkip: false, available: false, completed: false },
            },
          }),
        ],
      },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
    });

    await actions.stopAgentSession(getSession(sessionsRef));
    expect(stopCalls).toBe(1);
    expect(getSession(sessionsRef)?.status).toBe("stopped");
  });
});
