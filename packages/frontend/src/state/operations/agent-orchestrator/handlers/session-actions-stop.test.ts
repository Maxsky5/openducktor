import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { AgentSessionStopTarget } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { getAgentSession, replaceAgentSession } from "@/state/agent-session-collection";
import {
  findSessionMessageForTest,
  lastSessionMessageForTest,
} from "@/test-utils/session-message-test-helpers";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { listenToAgentSessionEvents } from "../events/session-events";
import { createSessionTurnMetadata } from "../support/session-turn-metadata";
import {
  createDeferred,
  createSessionObserversRefFixture,
  createTaskCardFixture,
} from "../test-utils";
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
    const stopTargets: AgentSessionStopTarget[] = [];

    const sessionsRef = createSessionsRef([
      buildSession({
        role: "planner",
        workingDirectory: "/tmp/repo",
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
      stopAuthoritativeSession: async (target) => {
        stopTargets.push(target);
      },
    });

    await actions.stopAgentSession(getSession(sessionsRef));
    expect(stopTargets).toEqual([
      {
        repoPath: "/tmp/repo",
        taskId: "task-1",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
        externalSessionId: "session-1",
      },
    ]);
    expect(getSession(sessionsRef)?.status).toBe("stopped");
    expect(getSession(sessionsRef)?.pendingApprovals).toHaveLength(0);
    expect(getSession(sessionsRef)?.pendingQuestions).toHaveLength(0);
  });

  test("keeps session active when authoritative session stop fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalStopSession = adapter.stopSession;
    let localStopCalls = 0;
    adapter.stopSession = async () => {
      localStopCalls += 1;
    };
    let unsubscribeCalls = 0;

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

    const stopAuthoritativeSession = async () => {
      throw new Error("build stop failed");
    };

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionObserversRef: createSessionObserversRefFixture([
        {
          externalSessionId: "session-1",
          unsubscribe: () => {
            unsubscribeCalls += 1;
          },
        },
      ]),
      sessionTurnState: sessionTurnState.sessionTurnState,
      stopAuthoritativeSession,
    });

    try {
      await expect(actions.stopAgentSession(getSession(sessionsRef))).rejects.toThrow(
        "Failed to stop build session 'session-1': build stop failed",
      );
      expect(localStopCalls).toBe(0);
      expect(unsubscribeCalls).toBe(0);
      expect(sessionTurnState.turnMetadata.readModel(sessionKey)).toBeNull();
      expect(getSession(sessionsRef)?.status).toBe("running");
      expect(getSession(sessionsRef)?.stopRequestedAt).toBeNull();
      expect(getSession(sessionsRef)?.pendingApprovals).toHaveLength(1);
      expect(getSession(sessionsRef)?.pendingQuestions).toHaveLength(1);
    } finally {
      adapter.stopSession = originalStopSession;
    }
  });

  test("records stop intent before awaiting authoritative session stop", async () => {
    const adapter = new OpencodeSdkAdapter();
    const stopDeferred = createDeferred<void>();
    const sessionsRef = createSessionsRef([
      buildSession({
        role: "build",
      }),
    ]);
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      stopAuthoritativeSession: async () => {
        await stopDeferred.promise;
      },
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
    let sessionEventListener: ((event: { type: string; [key: string]: unknown }) => void) | null =
      null;
    adapter.subscribeEvents = async (_externalSessionId, listener) => {
      sessionEventListener = listener as (event: { type: string; [key: string]: unknown }) => void;
      return () => {
        sessionEventListener = null;
      };
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        role: "build",
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
      }),
    ]);

    const updateSession = (
      identity: AgentSessionIdentity,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = getAgentSession(sessionsRef.current, identity);
      if (!current) {
        return null;
      }
      const nextSession = updater(current);
      sessionsRef.current = replaceAgentSession(sessionsRef.current, nextSession);
      return nextSession;
    };

    const unsubscribe = await listenToAgentSessionEvents({
      adapter,
      sessionRef: {
        externalSessionId: "session-1",
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      },
      turnMetadata: createSessionTurnMetadata(),
      readSession: (identity) => getAgentSession(sessionsRef.current, identity),
      updateSession,
      updateSessionTodos: () => {},
      isSessionObserved: (identity) => identity.externalSessionId === "session-1",
      buildReadOnlyApprovalRejectionMessage: async () => "Rejected by read-only policy.",
      recordTurnActivityTimestamp: () => {},
      recordTurnUserMessageTimestamp: () => {},
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      canAutoRejectReadOnlyApproval: () => false,
      resolveWorkflowToolAliasesByCanonical: () => undefined,
    });

    adapter.stopSession = async (externalSessionId) => {
      sessionEventListener?.({
        type: "session_finished",
        externalSessionId,
        timestamp: "2026-02-22T08:00:10.000Z",
        message: "Session stopped",
      });
    };

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionObserversRef: createSessionObserversRefFixture([
        { externalSessionId: "session-1", unsubscribe },
      ]),
      updateSession,
      observeAgentSession: async () => true,
    });

    try {
      await actions.stopAgentSession(getSession(sessionsRef));

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
        role: "build",
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

      expect(localStopCalls).toBe(0);
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

  test("continues cleanup when local adapter stop fails after authoritative stop", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalReleaseSession = adapter.releaseSession;
    const callOrder: string[] = [];
    adapter.releaseSession = async () => {
      callOrder.push("local-release");
      throw new Error("local release failed");
    };

    let unsubscribeCalls = 0;

    const sessionObserversRef = createSessionObserversRefFixture([
      {
        externalSessionId: "session-1",
        unsubscribe: () => {
          unsubscribeCalls += 1;
        },
      },
    ]);

    const sessionsRef = createSessionsRef([buildSession()]);
    const sessionKey = agentSessionIdentityKey(getSession(sessionsRef));
    const sessionTurnState = createSessionTurnStateFixture();
    sessionTurnState.assistantTurnTiming.recordTurnUserMessageTimestamp(sessionKey, 1);
    sessionTurnState.turnMetadata.recordModel(sessionKey, null);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionObserversRef,
      sessionTurnState: sessionTurnState.sessionTurnState,
      stopAuthoritativeSession: async () => {
        callOrder.push("host-stop");
      },
    });

    const originalWarn = console.warn;
    console.warn = () => {};

    try {
      await expect(actions.stopAgentSession(getSession(sessionsRef))).resolves.toBeUndefined();
      expect(callOrder).toEqual(["host-stop", "local-release"]);
      expect(unsubscribeCalls).toBe(1);
      expect(
        sessionTurnState.assistantTurnTiming.readTurnUserMessageStartedAtMs(sessionKey),
      ).toBeUndefined();
      expect(sessionTurnState.turnMetadata.readModel(sessionKey)).toBeUndefined();
      expect(getSession(sessionsRef)?.status).toBe("stopped");
    } finally {
      adapter.releaseSession = originalReleaseSession;
      console.warn = originalWarn;
    }
  });

  test("stops shared-runtime qa sessions authoritatively without runId", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalReleaseSession = adapter.releaseSession;
    let buildStopCalls = 0;
    let localReleaseCalls = 0;

    adapter.releaseSession = async () => {
      localReleaseCalls += 1;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        role: "qa",
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      stopAuthoritativeSession: async (target) => {
        buildStopCalls += 1;
        expect(target).toEqual({
          repoPath: "/tmp/repo",
          taskId: "task-1",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
          externalSessionId: "session-1",
        });
      },
    });

    try {
      await actions.stopAgentSession(getSession(sessionsRef));
      expect(buildStopCalls).toBe(1);
      expect(localReleaseCalls).toBe(1);
      expect(getSession(sessionsRef)?.status).toBe("stopped");
    } finally {
      adapter.releaseSession = originalReleaseSession;
    }
  });

  test("persists stopped snapshot before reloading host sessions", async () => {
    const adapter = new OpencodeSdkAdapter();

    const persistDeferred = createDeferred<void>();
    const callOrder: string[] = [];

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
      loadAgentSessions: async () => {
        callOrder.push("load-agent-sessions");
      },
      refreshTaskData: async () => {
        callOrder.push("refresh-task-data");
      },
      persistSessionRecord: async () => {
        callOrder.push("persist-start");
        await persistDeferred.promise;
        callOrder.push("persist-end");
      },
      stopAuthoritativeSession: async () => {
        callOrder.push("stop-authoritative-session");
      },
      invalidateSessionStopQueries: async () => {
        callOrder.push("invalidate-stop-queries");
      },
    });

    const stopPromise = actions.stopAgentSession(getSession(sessionsRef));
    await Promise.resolve();

    expect(callOrder).toContain("stop-authoritative-session");
    expect(callOrder).not.toContain("load-agent-sessions");

    persistDeferred.resolve();
    await stopPromise;

    const persistEndIndex = callOrder.indexOf("persist-end");
    expect(persistEndIndex).toBeGreaterThan(-1);
    expect(callOrder.indexOf("invalidate-stop-queries")).toBeGreaterThan(persistEndIndex);
    expect(callOrder.indexOf("refresh-task-data")).toBeGreaterThan(persistEndIndex);
    expect(callOrder.indexOf("load-agent-sessions")).toBeGreaterThan(persistEndIndex);
    expect(getSession(sessionsRef)?.status).toBe("stopped");
    expect(getSession(sessionsRef)?.pendingApprovals).toHaveLength(0);
    expect(getSession(sessionsRef)?.pendingQuestions).toHaveLength(0);
  });

  test("refreshes backend-owned state after successful authoritative stop", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalReleaseSession = adapter.releaseSession;
    let refreshTaskDataCalls = 0;
    let loadAgentSessionsCalls = 0;
    let localReleaseCalls = 0;
    const invalidationCalls: Array<{ repoPath: string; taskId: string; runtimeKind?: string }> = [];

    adapter.releaseSession = async () => {
      localReleaseCalls += 1;
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
      loadAgentSessions: async () => {
        loadAgentSessionsCalls += 1;
      },
      refreshTaskData: async () => {
        refreshTaskDataCalls += 1;
      },
      invalidateSessionStopQueries: async (input) => {
        invalidationCalls.push(input);
      },
    });

    try {
      await actions.stopAgentSession(getSession(sessionsRef));
      expect(localReleaseCalls).toBe(1);
      expect(refreshTaskDataCalls).toBe(1);
      expect(loadAgentSessionsCalls).toBe(1);
      expect(invalidationCalls).toEqual([
        {
          repoPath: "/tmp/repo",
          taskId: "task-1",
        },
      ]);
    } finally {
      adapter.releaseSession = originalReleaseSession;
    }
  });

  test("fails fast when stopping without an active workspace", async () => {
    const adapter = new OpencodeSdkAdapter();
    const stopTargets: AgentSessionStopTarget[] = [];
    const refreshTaskDataCalls: string[] = [];
    const invalidationCalls: Array<{ repoPath: string; taskId: string; runtimeKind?: string }> = [];
    let loadAgentSessionsCalls = 0;

    const sessionsRef = createSessionsRef([buildSession()]);

    const actions = createSessionActions({
      workspaceRepoPath: null,
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
      loadAgentSessions: async () => {
        loadAgentSessionsCalls += 1;
      },
      refreshTaskData: async (repoPath) => {
        refreshTaskDataCalls.push(repoPath);
      },
      stopAuthoritativeSession: async (target) => {
        stopTargets.push(target);
      },
      invalidateSessionStopQueries: async (input) => {
        invalidationCalls.push(input);
      },
    });

    await expect(actions.stopAgentSession(getSession(sessionsRef))).rejects.toThrow(
      "Active workspace repo path is unavailable.",
    );

    expect(stopTargets).toEqual([]);
    expect(invalidationCalls).toEqual([]);
    expect(refreshTaskDataCalls).toEqual([]);
    expect(loadAgentSessionsCalls).toBe(0);
  });

  test("allows stopping a running session even when role is unavailable", async () => {
    const adapter = new OpencodeSdkAdapter();
    let stopCalls = 0;
    const sessionsRef = createSessionsRef([
      buildSession({ status: "running", role: "build", taskId: "task-1" }),
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
      sessionObserversRef: createSessionObserversRefFixture([{ externalSessionId: "session-1" }]),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
      stopAuthoritativeSession: async () => {
        stopCalls += 1;
      },
    });

    await actions.stopAgentSession(getSession(sessionsRef));
    expect(stopCalls).toBe(1);
    expect(getSession(sessionsRef)?.status).toBe("stopped");
  });
});
