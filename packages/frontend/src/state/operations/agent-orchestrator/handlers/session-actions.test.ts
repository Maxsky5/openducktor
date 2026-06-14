import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { AgentSessionStopTarget } from "@openducktor/contracts";
import {
  type AgentSessionCollection,
  createAgentSessionCollection,
  getAgentSession,
  listAgentSessions,
  replaceAgentSession,
  replaceAgentSessionByIdentity,
} from "@/state/agent-session-collection";
import {
  findSessionMessageForTest,
  lastSessionMessageForTest,
  sessionMessageAt,
  sessionMessagesToArray,
} from "@/test-utils/session-message-test-helpers";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { listenToAgentSessionEvents } from "../events/session-events";
import {
  createAgentSessionPresenceSnapshotFixture,
  createDeferred,
  createSessionListenerRegistryRefFixture,
  createTaskCardFixture,
} from "../test-utils";
import { createAgentSessionActions } from "./session-actions";

const buildSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  runtimeKind: "opencode",
  externalSessionId: "session-1",
  taskId: "task-1",
  role: "build",
  status: "running",
  startedAt: "2026-02-22T08:00:00.000Z",
  workingDirectory: "/tmp/repo/worktree",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: null,
  ...overrides,
  historyLoadState: overrides.historyLoadState ?? "not_requested",
});

const getSession = (
  sessionsRef: { current: AgentSessionCollection },
  externalSessionId = "session-1",
): AgentSessionState => {
  const session =
    listAgentSessions(sessionsRef.current).find(
      (entry) => entry.externalSessionId === externalSessionId,
    ) ?? null;
  if (!session) {
    throw new Error(`Expected session ${externalSessionId}`);
  }
  return session;
};

const createSessionsRef = (sessions: AgentSessionState[] = []) => ({
  current: createAgentSessionCollection(sessions),
});

const mockAgentSessionPresenceSnapshot = (
  adapter: OpencodeSdkAdapter,
  snapshot: ReturnType<
    typeof createAgentSessionPresenceSnapshotFixture
  > = createAgentSessionPresenceSnapshotFixture({ ref: { externalSessionId: "session-1" } }),
): ReturnType<typeof createAgentSessionPresenceSnapshotFixture> => {
  adapter.listSessionPresence = async () => [snapshot];
  adapter.readSessionPresence = async () => snapshot;
  return snapshot;
};

type SessionActionDependencies = Parameters<typeof createAgentSessionActions>[0];
const createDefaultActiveWorkspace = () => ({
  repoPath: "/tmp/repo",
  workspaceId: "workspace-1",
  workspaceName: "Active Workspace",
});

const createSessionActions = (overrides: Partial<SessionActionDependencies> = {}) => {
  const adapter = overrides.adapter ?? new OpencodeSdkAdapter();
  const sessionsRef = overrides.sessionsRef ?? createSessionsRef();
  sessionsRef.current = createAgentSessionCollection(listAgentSessions(sessionsRef.current));
  const userMessageStartedAtBySession: Record<string, number> = {};

  const dependencies: SessionActionDependencies = {
    activeWorkspace: createDefaultActiveWorkspace(),
    adapter,
    setSessionCollection: () => {},
    sessionsRef,
    taskRef: { current: [createTaskCardFixture({ id: "task-1" })] },
    repoEpochRef: { current: 1 },
    currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
    inFlightStartsByWorkspaceTaskRef: { current: new Map() },
    sessionListenerRegistryRef: createSessionListenerRegistryRefFixture(),
    recordTurnUserMessageTimestamp: (externalSessionId, timestamp) => {
      const timestampMs = typeof timestamp === "number" ? timestamp : Date.parse(timestamp);
      if (!Number.isFinite(timestampMs)) {
        return userMessageStartedAtBySession[externalSessionId];
      }
      const current = userMessageStartedAtBySession[externalSessionId];
      const next = typeof current === "number" ? Math.min(current, timestampMs) : timestampMs;
      userMessageStartedAtBySession[externalSessionId] = next;
      return next;
    },
    readTurnUserMessageStartedAtMs: (externalSessionId) =>
      userMessageStartedAtBySession[externalSessionId],
    updateSession: (identity, updater) => {
      const current = getAgentSession(sessionsRef.current, identity);
      if (!current) {
        return;
      }
      sessionsRef.current = replaceAgentSessionByIdentity(
        sessionsRef.current,
        identity,
        updater(current),
      );
    },
    listenToAgentSession: async () => {},
    resolveTaskWorktree: async () => null,
    ensureRuntime: async () => ({
      kind: "opencode",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo",
    }),
    loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
    loadRepoPromptOverrides: async () => ({}),
    loadAgentSessions: async () => {},
    loadAgentSessionHistory: async () => {},
    clearTurnDuration: () => {},
    refreshTaskData: async () => {},
    persistSessionRecord: async () => {},
    stopAuthoritativeSession: async () => {},
    invalidateSessionStopQueries: async () => {},
  };

  return createAgentSessionActions({
    ...dependencies,
    ...overrides,
    adapter,
    sessionsRef,
  });
};

describe("agent-orchestrator/handlers/session-actions", () => {
  test("returns action handlers", () => {
    const actions = createSessionActions({ updateSession: () => {} });

    expect(typeof actions.ensureSessionReady).toBe("function");
    expect(typeof actions.sendAgentMessage).toBe("function");
    expect(typeof actions.startAgentSession).toBe("function");
    expect(typeof actions.stopAgentSession).toBe("function");
  });

  test("uses live workspace refs for session start stale checks", async () => {
    const adapter = new OpencodeSdkAdapter();
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    const actions = createSessionActions({
      adapter,
      currentWorkspaceRepoPathRef,
      updateSession: () => {},
    });

    currentWorkspaceRepoPathRef.current = "/tmp/other";

    await expect(
      actions.startAgentSession({
        taskId: "task-1",
        role: "build",
        startMode: "fresh",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5.4",
          variant: "high",
          profileId: "Hephaestus (Deep Agent)",
        },
      }),
    ).rejects.toThrow("Workspace changed while starting session.");
  });

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

    try {
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
    } finally {
    }
  });

  test("keeps session active when authoritative session stop fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalStopSession = adapter.stopSession;
    let localStopCalls = 0;
    adapter.stopSession = async () => {
      localStopCalls += 1;
    };
    let clearCalls = 0;
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

    const stopAuthoritativeSession = async () => {
      throw new Error("build stop failed");
    };

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionListenerRegistryRef: createSessionListenerRegistryRefFixture([
        {
          externalSessionId: "session-1",
          unsubscribe: () => {
            unsubscribeCalls += 1;
          },
        },
      ]),
      clearTurnDuration: () => {
        clearCalls += 1;
      },
      stopAuthoritativeSession,
    });

    try {
      await expect(actions.stopAgentSession(getSession(sessionsRef))).rejects.toThrow(
        "Failed to stop build session 'session-1': build stop failed",
      );
      expect(clearCalls).toBe(0);
      expect(localStopCalls).toBe(0);
      expect(unsubscribeCalls).toBe(0);
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

    try {
      const stopPromise = actions.stopAgentSession(getSession(sessionsRef));
      await Promise.resolve();

      expect(getSession(sessionsRef)?.stopRequestedAt).toBeString();
      expect(getSession(sessionsRef)?.status).toBe("running");

      stopDeferred.resolve();
      await stopPromise;

      expect(getSession(sessionsRef)?.stopRequestedAt).toBeNull();
      expect(getSession(sessionsRef)?.status).toBe("stopped");
    } finally {
    }
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
        return;
      }
      sessionsRef.current = replaceAgentSession(sessionsRef.current, updater(current));
    };

    const unsubscribe = await listenToAgentSessionEvents({
      adapter,
      sessionRef: {
        externalSessionId: "session-1",
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      },
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      updateSession,
      runtimeDataWriter: { updateTodos: () => {} },
      buildReadOnlyApprovalRejectionMessage: async () => "Rejected by read-only policy.",
      recordTurnActivityTimestamp: () => {},
      recordTurnUserMessageTimestamp: () => {},
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
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
      sessionListenerRegistryRef: createSessionListenerRegistryRefFixture([
        { externalSessionId: "session-1", unsubscribe },
      ]),
      updateSession,
      listenToAgentSession: async () => undefined,
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

    let clearCalls = 0;
    let unsubscribeCalls = 0;

    const sessionListenerRegistryRef = createSessionListenerRegistryRefFixture([
      {
        externalSessionId: "session-1",
        unsubscribe: () => {
          unsubscribeCalls += 1;
        },
      },
    ]);

    const sessionsRef = createSessionsRef([buildSession()]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionListenerRegistryRef,
      clearTurnDuration: () => {
        clearCalls += 1;
      },
      stopAuthoritativeSession: async () => {
        callOrder.push("host-stop");
      },
    });

    const originalWarn = console.warn;
    console.warn = () => {};

    try {
      await expect(actions.stopAgentSession(getSession(sessionsRef))).resolves.toBeUndefined();
      expect(callOrder).toEqual(["host-stop", "local-release"]);
      expect(clearCalls).toBe(1);
      expect(unsubscribeCalls).toBe(1);
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

    try {
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
    } finally {
    }
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
      activeWorkspace: null,
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

  test("updates selected model and removes resolved permission", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalUpdateSessionModel = adapter.updateSessionModel;
    const originalReplyApproval = adapter.replyApproval;
    let replyCalls = 0;
    adapter.updateSessionModel = () => {};
    adapter.replyApproval = async () => {
      replyCalls += 1;
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
      }),
    ]);
    const updateSessionOptions: unknown[] = [];

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      updateSession: (identity, updater, options) => {
        const current = getAgentSession(sessionsRef.current, identity);
        if (!current) {
          return;
        }
        updateSessionOptions.push(options);
        sessionsRef.current = replaceAgentSession(sessionsRef.current, updater(current));
      },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      actions.updateAgentSessionModel(getSession(sessionsRef), {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
      });
      expect(getSession(sessionsRef)?.selectedModel?.modelId).toBe("gpt-5");
      expect(updateSessionOptions).toEqual([{ persist: true }]);

      await actions.replyAgentApproval(getSession(sessionsRef), "perm-1", "approve_once");
      expect(replyCalls).toBe(1);
      expect(getSession(sessionsRef)?.pendingApprovals).toHaveLength(0);
      expect(updateSessionOptions).toEqual([{ persist: true }, { persist: false }]);
    } finally {
      adapter.updateSessionModel = originalUpdateSessionModel;
      adapter.replyApproval = originalReplyApproval;
    }
  });

  test("replies to permission after resuming a session with pending live input", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalListAgentSessionPresenceSnapshots = adapter.listSessionPresence;
    const originalResumeSession = adapter.resumeSession;
    const originalReplyApproval = adapter.replyApproval;
    let resumeCalls = 0;
    let replyCalls = 0;
    mockAgentSessionPresenceSnapshot(
      adapter,
      createAgentSessionPresenceSnapshotFixture({
        ref: {
          externalSessionId: "session-1",
          workingDirectory: "/tmp/repo",
        },
        snapshot: {
          externalSessionId: "session-1",
          title: "Build",
          workingDirectory: "/tmp/repo",
          startedAt: "2026-02-22T08:00:00.000Z",
          status: { type: "idle" },
          pendingApprovals: [
            {
              requestId: "perm-1",
              requestType: "permission_grant" as const,
              title: `Approve permission: ${"read"}`,
              summary: `Approval request for ${"read"}.`,
              affectedPaths: [".env"],
              action: { name: "read" },
              mutation: "read_only" as const,
              supportedReplyOutcomes: [
                "approve_once" as const,
                "approve_session" as const,
                "reject" as const,
              ],
            },
          ],
          pendingQuestions: [],
        },
      }),
    );
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return {
        externalSessionId: input.externalSessionId,
        workingDirectory: input.workingDirectory,
        role: input.role,
        startedAt: "2026-02-22T08:00:00.000Z",
        status: "idle",
        runtimeKind: input.runtimeKind,
      };
    };
    adapter.replyApproval = async () => {
      replyCalls += 1;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "stopped",
        externalSessionId: "session-1",
        pendingApprovals: [
          {
            requestId: "perm-1",
            requestType: "permission_grant" as const,
            title: `Approve permission: ${"read"}`,
            summary: `Approval request for ${"read"}.`,
            affectedPaths: [".env"],
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

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      sessionListenerRegistryRef: createSessionListenerRegistryRefFixture([
        { externalSessionId: "session-1" },
      ]),
    });

    try {
      await actions.replyAgentApproval(getSession(sessionsRef), "perm-1", "approve_once");
      expect(resumeCalls).toBe(0);
      expect(replyCalls).toBe(1);
      expect(getSession(sessionsRef)?.pendingApprovals).toEqual([]);
    } finally {
      adapter.listSessionPresence = originalListAgentSessionPresenceSnapshots;
      adapter.resumeSession = originalResumeSession;
      adapter.replyApproval = originalReplyApproval;
    }
  });

  test("requires a loaded local session before replying to permission", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalReplyApproval = adapter.replyApproval;
    let replyCalls = 0;
    adapter.replyApproval = async () => {
      replyCalls += 1;
    };
    let updateCalls = 0;

    const actions = createSessionActions({
      adapter,
      sessionsRef: createSessionsRef(),
      updateSession: () => {
        updateCalls += 1;
      },
    });

    try {
      await expect(
        actions.replyAgentApproval(
          buildSession({ externalSessionId: "session-transcript-1" }),
          "perm-1",
          "approve_once",
        ),
      ).rejects.toThrow("Session 'session-transcript-1' is not loaded.");

      expect(replyCalls).toBe(0);
      expect(updateCalls).toBe(0);
    } finally {
      adapter.replyApproval = originalReplyApproval;
    }
  });

  test("answers question and annotates matching tool message metadata", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalReplyQuestion = adapter.replyQuestion;
    let replyCalls = 0;
    adapter.replyQuestion = async () => {
      replyCalls += 1;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        messages: [
          {
            id: "tool-1",
            role: "tool",
            content: "Question requested",
            timestamp: "2026-02-22T08:00:01.000Z",
            meta: {
              kind: "tool",
              partId: "part-1",
              callId: "call-1",
              tool: "question",
              toolType: "question" as const,
              status: "completed",
              metadata: {},
            },
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
    const updateSessionOptions: unknown[] = [];

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      updateSession: (identity, updater, options) => {
        const current = getAgentSession(sessionsRef.current, identity);
        if (!current) {
          return;
        }
        updateSessionOptions.push(options);
        sessionsRef.current = replaceAgentSession(sessionsRef.current, updater(current));
      },
    });

    try {
      await actions.answerAgentQuestion(getSession(sessionsRef), "question-1", [["yes"]]);
      expect(replyCalls).toBe(1);
      expect(getSession(sessionsRef)?.pendingQuestions).toHaveLength(0);
      expect(updateSessionOptions).toEqual([{ persist: false }]);
      const message = sessionMessageAt(getSession(sessionsRef), 0);
      if (message?.meta?.kind !== "tool") {
        throw new Error("Expected tool message metadata");
      }
      expect(message.meta.metadata?.requestId).toBe("question-1");
      expect(message.meta.metadata?.answers).toEqual([["yes"]]);
    } finally {
      adapter.replyQuestion = originalReplyQuestion;
    }
  });

  test("requires a loaded local session before answering a question", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalReplyQuestion = adapter.replyQuestion;
    let replyCalls = 0;
    adapter.replyQuestion = async () => {
      replyCalls += 1;
    };
    let updateCalls = 0;

    const actions = createSessionActions({
      adapter,
      sessionsRef: createSessionsRef(),
      updateSession: () => {
        updateCalls += 1;
      },
    });

    try {
      await expect(
        actions.answerAgentQuestion(
          buildSession({ externalSessionId: "session-transcript-1" }),
          "question-1",
          [["yes"]],
        ),
      ).rejects.toThrow("Session 'session-transcript-1' is not loaded.");

      expect(replyCalls).toBe(0);
      expect(updateCalls).toBe(0);
    } finally {
      adapter.replyQuestion = originalReplyQuestion;
    }
  });

  test("answers question after resuming a session with pending live input", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalListAgentSessionPresenceSnapshots = adapter.listSessionPresence;
    const originalResumeSession = adapter.resumeSession;
    const originalReplyQuestion = adapter.replyQuestion;
    let resumeCalls = 0;
    let replyCalls = 0;
    mockAgentSessionPresenceSnapshot(
      adapter,
      createAgentSessionPresenceSnapshotFixture({
        ref: {
          externalSessionId: "session-1",
          workingDirectory: "/tmp/repo",
        },
        snapshot: {
          externalSessionId: "session-1",
          title: "Build",
          workingDirectory: "/tmp/repo",
          startedAt: "2026-02-22T08:00:00.000Z",
          status: { type: "idle" },
          pendingApprovals: [],
          pendingQuestions: [
            {
              requestId: "question-1",
              questions: [{ header: "Confirm", question: "Confirm", options: [], custom: false }],
            },
          ],
        },
      }),
    );
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return {
        externalSessionId: input.externalSessionId,
        workingDirectory: input.workingDirectory,
        role: input.role,
        startedAt: "2026-02-22T08:00:00.000Z",
        status: "idle",
        runtimeKind: input.runtimeKind,
      };
    };
    adapter.replyQuestion = async () => {
      replyCalls += 1;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "stopped",
        externalSessionId: "session-1",
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

    try {
      await actions.answerAgentQuestion(getSession(sessionsRef), "question-1", [["yes"]]);
      expect(resumeCalls).toBe(0);
      expect(replyCalls).toBe(1);
      expect(getSession(sessionsRef)?.pendingQuestions).toEqual([]);
    } finally {
      adapter.listSessionPresence = originalListAgentSessionPresenceSnapshots;
      adapter.resumeSession = originalResumeSession;
      adapter.replyQuestion = originalReplyQuestion;
    }
  });

  test("delegates sent user messages to the runtime transcript stream", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalListAgentSessionPresenceSnapshots = adapter.listSessionPresence;
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    mockAgentSessionPresenceSnapshot(adapter);
    adapter.sendUserMessage = async () => {
      sendCalls += 1;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "idle",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5.3-codex",
          variant: "high",
          profileId: "Hephaestus (Deep Agent)",
        },
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionListenerRegistryRef: createSessionListenerRegistryRefFixture([
        { externalSessionId: "session-1" },
      ]),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]);
      expect(sendCalls).toBe(1);
      expect(getSession(sessionsRef)?.status).toBe("running");
      expect(sessionMessagesToArray(getSession(sessionsRef))).toHaveLength(0);
    } finally {
      adapter.listSessionPresence = originalListAgentSessionPresenceSnapshots;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("releases held starting sessions to running when sending starts", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalListAgentSessionPresenceSnapshots = adapter.listSessionPresence;
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    const committedStatuses: AgentSessionState["status"][] = [];
    mockAgentSessionPresenceSnapshot(
      adapter,
      createAgentSessionPresenceSnapshotFixture({
        ref: { externalSessionId: "session-1" },
        snapshot: { status: { type: "idle" } },
      }),
    );
    adapter.sendUserMessage = async () => {
      sendCalls += 1;
    };

    const sessionsRef = createSessionsRef([buildSession({ status: "starting" })]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionListenerRegistryRef: createSessionListenerRegistryRefFixture([
        { externalSessionId: "session-1" },
      ]),
      updateSession: (identity, updater) => {
        const current = getAgentSession(sessionsRef.current, identity);
        if (!current) {
          return;
        }
        const next = updater(current);
        if (current.status === "starting") {
          expect(next.status).not.toBe("idle");
        }
        committedStatuses.push(next.status);
        sessionsRef.current = replaceAgentSession(sessionsRef.current, next);
      },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]);

      expect(sendCalls).toBe(1);
      expect(committedStatuses).not.toContain("idle");
      expect(getSession(sessionsRef)?.status).toBe("running");
    } finally {
      adapter.listSessionPresence = originalListAgentSessionPresenceSnapshots;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("releases held starting sessions to idle when pending input prevents sending", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    adapter.sendUserMessage = async () => {
      sendCalls += 1;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "starting",
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [{ header: "Confirm", question: "Confirm", options: [] }],
          },
        ],
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionListenerRegistryRef: createSessionListenerRegistryRefFixture([
        { externalSessionId: "session-1" },
      ]),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]);

      expect(sendCalls).toBe(0);
      expect(getSession(sessionsRef)?.status).toBe("idle");
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("marks held starting sessions as failed when resume preparation fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    adapter.readSessionPresence = async () => ({
      presence: "missing",
      classification: "missing",
      ref: {
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        externalSessionId: "session-1",
      },
      pendingApprovals: [],
      pendingQuestions: [],
    });
    adapter.sendUserMessage = async () => {
      sendCalls += 1;
    };

    const sessionsRef = createSessionsRef([buildSession({ status: "starting" })]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionListenerRegistryRef: createSessionListenerRegistryRefFixture([
        { externalSessionId: "session-1" },
      ]),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      await expect(
        actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]),
      ).rejects.toThrow("Task not found: task-1");

      expect(sendCalls).toBe(0);
      expect(getSession(sessionsRef)?.status).toBe("error");
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("does not load requested history before sending to a runtime session", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalListAgentSessionPresenceSnapshots = adapter.listSessionPresence;
    const originalSendUserMessage = adapter.sendUserMessage;
    const callOrder: string[] = [];
    mockAgentSessionPresenceSnapshot(adapter);
    adapter.sendUserMessage = async () => {
      callOrder.push("send");
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "idle",
        historyLoadState: "not_requested",
        messages: [],
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionListenerRegistryRef: createSessionListenerRegistryRefFixture([
        { externalSessionId: "session-1" },
      ]),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
      loadAgentSessions: async () => {
        callOrder.push("load");
      },
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]);

      expect(callOrder).toEqual(["send"]);
      expect(sessionMessagesToArray(getSession(sessionsRef))).toHaveLength(0);
      expect(getSession(sessionsRef)?.historyLoadState).toBe("not_requested");
    } finally {
      adapter.listSessionPresence = originalListAgentSessionPresenceSnapshots;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("does not send a free-form message if ensure-ready reveals pending input", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalListAgentSessionPresenceSnapshots = adapter.listSessionPresence;
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    mockAgentSessionPresenceSnapshot(
      adapter,
      createAgentSessionPresenceSnapshotFixture({
        ref: { externalSessionId: "session-1", workingDirectory: "/tmp/repo/worktree" },
        snapshot: {
          externalSessionId: "session-1",
          status: { type: "idle" },
          title: "Session 1",
          workingDirectory: "/tmp/repo/worktree",
          startedAt: "2026-02-22T08:00:00.000Z",
          pendingApprovals: [],
          pendingQuestions: [
            {
              requestId: "question-1",
              questions: [{ header: "Confirm", question: "Confirm", options: [] }],
            },
          ],
        },
      }),
    );
    adapter.sendUserMessage = async () => {
      sendCalls += 1;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "idle",
        historyLoadState: "not_requested",
        messages: [],
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionListenerRegistryRef: createSessionListenerRegistryRefFixture([
        { externalSessionId: "session-1" },
      ]),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      await expect(
        actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]),
      ).rejects.toThrow("Session is waiting for pending runtime input.");

      expect(sendCalls).toBe(0);
      expect(getSession(sessionsRef)?.status).toBe("idle");
      expect(getSession(sessionsRef)?.pendingQuestions).toHaveLength(1);
    } finally {
      adapter.listSessionPresence = originalListAgentSessionPresenceSnapshots;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("does not send free-form messages while waiting for pending input", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    adapter.sendUserMessage = async () => {
      sendCalls += 1;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "idle",
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [{ header: "Confirm", question: "Confirm", options: [] }],
          },
        ],
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionListenerRegistryRef: createSessionListenerRegistryRefFixture([
        { externalSessionId: "session-1" },
      ]),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: " hello " }]);
      expect(sendCalls).toBe(0);
      expect(sessionMessagesToArray(getSession(sessionsRef))).toHaveLength(0);
      expect(getSession(sessionsRef)?.pendingQuestions).toHaveLength(1);
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("rejects send when role is unavailable for the current task", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    adapter.sendUserMessage = async () => {
      sendCalls += 1;
    };

    const sessionsRef = createSessionsRef([
      buildSession({ status: "idle", role: "build", taskId: "task-1" }),
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
      sessionListenerRegistryRef: createSessionListenerRegistryRefFixture([
        { externalSessionId: "session-1" },
      ]),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      await expect(
        actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]),
      ).rejects.toThrow("Role 'build' is unavailable for task 'task-1' in status 'open'.");
      expect(sendCalls).toBe(0);
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
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
      sessionListenerRegistryRef: createSessionListenerRegistryRefFixture([
        { externalSessionId: "session-1" },
      ]),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
      stopAuthoritativeSession: async () => {
        stopCalls += 1;
      },
    });

    try {
      await actions.stopAgentSession(getSession(sessionsRef));
      expect(stopCalls).toBe(1);
      expect(getSession(sessionsRef)?.status).toBe("stopped");
    } finally {
    }
  });

  test("marks session as error when send fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalListAgentSessionPresenceSnapshots = adapter.listSessionPresence;
    const originalSendUserMessage = adapter.sendUserMessage;
    let clearCalls = 0;
    mockAgentSessionPresenceSnapshot(adapter);
    adapter.sendUserMessage = async () => {
      throw new Error("send failed");
    };

    const sessionsRef = createSessionsRef([buildSession({ status: "idle" })]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionListenerRegistryRef: createSessionListenerRegistryRefFixture([
        { externalSessionId: "session-1" },
      ]),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
      clearTurnDuration: () => {
        clearCalls += 1;
      },
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]);
      expect(getSession(sessionsRef)?.status).toBe("error");
      const failureMessage = findSessionMessageForTest(getSession(sessionsRef), (message) =>
        message.content.includes("Failed to send message:"),
      );
      expect(failureMessage?.content).toContain("Failed to send message:");
      expect(failureMessage?.meta).toEqual({
        kind: "session_notice",
        tone: "error",
        reason: "session_error",
        title: "Error",
      });
      expect(clearCalls).toBe(1);
    } finally {
      adapter.listSessionPresence = originalListAgentSessionPresenceSnapshots;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("preserves active turn drafts and timing for busy queued sends", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalListAgentSessionPresenceSnapshots = adapter.listSessionPresence;
    const originalSendUserMessage = adapter.sendUserMessage;
    const sendCalls: Array<{
      externalSessionId: string;
      parts: { kind: string; text?: string }[];
    }> = [];
    mockAgentSessionPresenceSnapshot(
      adapter,
      createAgentSessionPresenceSnapshotFixture({
        ref: { externalSessionId: "session-1" },
        snapshot: { status: { type: "busy" } },
      }),
    );
    adapter.sendUserMessage = async (input) => {
      sendCalls.push({
        externalSessionId: input.externalSessionId,
        parts: input.parts.map((part) =>
          part.kind === "text" ? { kind: part.kind, text: part.text } : { kind: part.kind },
        ),
      });
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "running",
        draftAssistantText: "Still working",
        draftAssistantMessageId: "assistant-live-1",
        draftReasoningText: "Thinking",
        draftReasoningMessageId: "reasoning-live-1",
      }),
    ]);
    let recordUserAnchorCalls = 0;
    const turnModelBySessionRef = {
      current: {
        "session-1": {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
        },
      } as Record<string, AgentSessionState["selectedModel"]>,
    };

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionListenerRegistryRef: createSessionListenerRegistryRefFixture([
        { externalSessionId: "session-1" },
      ]),
      turnModelBySessionRef,
      recordTurnUserMessageTimestamp: () => {
        recordUserAnchorCalls += 1;
        return 1234;
      },
      readTurnUserMessageStartedAtMs: () => 1234,
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
      clearTurnDuration: () => {
        throw new Error("busy queued send should not clear turn timing");
      },
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [
        { kind: "text", text: "queued follow-up" },
      ]);

      expect(sendCalls).toEqual([
        { externalSessionId: "session-1", parts: [{ kind: "text", text: "queued follow-up" }] },
      ]);
      expect(getSession(sessionsRef)?.draftAssistantText).toBe("Still working");
      expect(getSession(sessionsRef)?.draftAssistantMessageId).toBe("assistant-live-1");
      expect(getSession(sessionsRef)?.draftReasoningText).toBe("Thinking");
      expect(getSession(sessionsRef)?.draftReasoningMessageId).toBe("reasoning-live-1");
      expect(recordUserAnchorCalls).toBe(0);
      expect(turnModelBySessionRef.current["session-1"]?.modelId).toBe("gpt-5");
    } finally {
      adapter.listSessionPresence = originalListAgentSessionPresenceSnapshots;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("keeps the active turn running when a busy queued send fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalListAgentSessionPresenceSnapshots = adapter.listSessionPresence;
    const originalSendUserMessage = adapter.sendUserMessage;
    let clearCalls = 0;
    mockAgentSessionPresenceSnapshot(
      adapter,
      createAgentSessionPresenceSnapshotFixture({
        ref: { externalSessionId: "session-1" },
        snapshot: { status: { type: "busy" } },
      }),
    );
    adapter.sendUserMessage = async () => {
      throw new Error("queued send failed");
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "running",
        draftAssistantText: "Still working",
        draftAssistantMessageId: "assistant-live-1",
        draftReasoningText: "Thinking",
        draftReasoningMessageId: "reasoning-live-1",
      }),
    ]);
    let recordUserAnchorCalls = 0;
    const turnModelBySessionRef = {
      current: {
        "session-1": {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
        },
      } as Record<string, AgentSessionState["selectedModel"]>,
    };

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionListenerRegistryRef: createSessionListenerRegistryRefFixture([
        { externalSessionId: "session-1" },
      ]),
      turnModelBySessionRef,
      recordTurnUserMessageTimestamp: () => {
        recordUserAnchorCalls += 1;
        return 1234;
      },
      readTurnUserMessageStartedAtMs: () => 1234,
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
      clearTurnDuration: () => {
        clearCalls += 1;
      },
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [
        { kind: "text", text: "queued follow-up" },
      ]);

      expect(getSession(sessionsRef)?.status).toBe("running");
      expect(getSession(sessionsRef)?.draftAssistantText).toBe("Still working");
      expect(getSession(sessionsRef)?.draftReasoningText).toBe("Thinking");
      const failureMessage = findSessionMessageForTest(getSession(sessionsRef), (message) =>
        message.content.includes("Failed to send message:"),
      );
      expect(failureMessage?.content).toContain("Failed to send message:");
      expect(failureMessage?.meta).toEqual({
        kind: "session_notice",
        tone: "error",
        reason: "session_error",
        title: "Error",
      });
      expect(clearCalls).toBe(0);
      expect(recordUserAnchorCalls).toBe(0);
      expect(turnModelBySessionRef.current["session-1"]?.modelId).toBe("gpt-5");
    } finally {
      adapter.listSessionPresence = originalListAgentSessionPresenceSnapshots;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });
});
