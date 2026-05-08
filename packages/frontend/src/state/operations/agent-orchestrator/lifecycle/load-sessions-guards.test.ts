import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type AgentSessionState,
  createAdapter,
  createLoadAgentSessions,
  createTaskFixture,
  createTestQueryClient,
  type LegacyRunSummary,
  OPENCODE_RUNTIME_DESCRIPTOR,
  persistedSessionRecord,
  type RuntimeInstanceSummary,
  runtimeQueryKeys,
  sessionMessagesToArray,
  setupDefaultLoadSessionsHost,
} from "./load-sessions-test-harness";

let _legacyHost!: { runsList: (repoPath?: string) => Promise<LegacyRunSummary[]> };

describe("agent-orchestrator load-session guards and persisted records", () => {
  let restoreDefaultHost: (() => void) | null = null;
  let queryClient!: ReturnType<typeof createTestQueryClient>;

  beforeEach(async () => {
    queryClient = createTestQueryClient();
    const hostDefaults = await setupDefaultLoadSessionsHost();
    _legacyHost = hostDefaults.legacyHost;
    restoreDefaultHost = hostDefaults.restore;
  });

  afterEach(() => {
    queryClient.clear();
    restoreDefaultHost?.();
    restoreDefaultHost = null;
  });

  test("no-ops when active repo is missing", async () => {
    let setCalled = false;
    const loadAgentSessions = createLoadAgentSessions({
      queryClient,
      activeWorkspace: null,
      adapter: createAdapter(),
      repoEpochRef: { current: 0 },
      currentWorkspaceRepoPathRef: { current: null },
      sessionsRef: { current: {} },
      setSessionsById: () => {
        setCalled = true;
      },
      taskRef: { current: [createTaskFixture()] },
      updateSession: () => {},
      loadRepoPromptOverrides: async () => ({}),
    });

    await loadAgentSessions("task-1");

    expect(setCalled).toBe(false);
  });

  test("no-ops for blank task ids", async () => {
    let setCalled = false;
    const loadAgentSessions = createLoadAgentSessions({
      queryClient,
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter(),
      repoEpochRef: { current: 0 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef: { current: {} },
      setSessionsById: () => {
        setCalled = true;
      },
      taskRef: { current: [createTaskFixture()] },
      updateSession: () => {},
      loadRepoPromptOverrides: async () => ({}),
    });

    await loadAgentSessions("   ");

    expect(setCalled).toBe(false);
  });

  test("hydrates persisted session records into state map", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };

    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[externalSessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [externalSessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      queryClient,
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter(),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [createTaskFixture()] },
      updateSession,
      loadRepoPromptOverrides: async () => ({}),
    });

    const originalList = (await import("../../shared/host")).host.agentSessionsList;
    (await import("../../shared/host")).host.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
        pendingApprovals: [
          {
            requestId: "permission-1",
            requestType: "permission_grant" as const,
            title: `Approve permission: ${"read"}`,
            summary: `Approval request for ${"read"}.`,
            affectedPaths: ["**/*"],
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
                header: "Question",
                question: "Need answer",
                options: [],
                custom: true,
              },
            ],
          },
        ],
      }),
    ];

    try {
      await loadAgentSessions("task-1");
    } finally {
      (await import("../../shared/host")).host.agentSessionsList = originalList;
    }

    expect(Object.keys(state)).toContain("external-1");
    expect(state["external-1"]?.status).toBe("stopped");
    expect(state["external-1"]?.pendingApprovals).toEqual([]);
    expect(state["external-1"]?.pendingQuestions).toEqual([]);
  });

  test("does not merge persisted pending input into an existing session entry", async () => {
    const existingSession: AgentSessionState = {
      externalSessionId: "external-1",
      taskId: "task-1",
      repoPath: "/tmp/repo",
      role: "build",
      status: "idle",
      startedAt: "2026-02-22T08:00:00.000Z",
      runtimeKind: "opencode",
      runtimeId: null,
      runId: null,
      workingDirectory: "/tmp/repo",
      messages: [
        {
          id: "message-1",
          role: "assistant",
          timestamp: "2026-02-22T08:00:01.000Z",
          content: "Existing history",
          meta: { kind: "assistant", agentRole: "build", isFinal: true },
        },
      ],
      draftAssistantText: "",
      draftAssistantMessageId: null,
      draftReasoningText: "",
      draftReasoningMessageId: null,
      contextUsage: null,
      pendingApprovals: [],
      pendingQuestions: [],
      todos: [],
      modelCatalog: null,
      selectedModel: null,
      isLoadingModelCatalog: false,
      promptOverrides: {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: { "external-1": existingSession },
    };
    let state: Record<string, AgentSessionState> = sessionsRef.current;
    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };

    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[externalSessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [externalSessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      queryClient,
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter(),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [createTaskFixture()] },
      updateSession,
      loadRepoPromptOverrides: async () => ({}),
    });

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    hostModule.host.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        status: "idle",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:02.000Z",
        workingDirectory: "/tmp/repo",
        pendingApprovals: [
          {
            requestId: "permission-1",
            requestType: "permission_grant" as const,
            title: `Approve permission: ${"read"}`,
            summary: `Approval request for ${"read"}.`,
            affectedPaths: ["**/*"],
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
                header: "Question",
                question: "Need answer",
                options: [],
                custom: true,
              },
            ],
          },
        ],
      }),
    ];

    try {
      await loadAgentSessions("task-1");
    } finally {
      hostModule.host.agentSessionsList = originalList;
    }

    expect(state["external-1"] ? sessionMessagesToArray(state["external-1"]) : undefined).toEqual(
      sessionMessagesToArray(existingSession),
    );
    expect(state["external-1"]?.pendingApprovals).toEqual([]);
    expect(state["external-1"]?.pendingQuestions).toEqual([]);
  });

  test("clears pending permissions when the live snapshot reports no pending input", async () => {
    const existingSession: AgentSessionState = {
      externalSessionId: "external-1",
      taskId: "task-1",
      repoPath: "/tmp/repo",
      role: "build",
      status: "idle",
      startedAt: "2026-02-22T08:00:00.000Z",
      runtimeKind: "opencode",
      runtimeId: null,
      runId: null,
      workingDirectory: "/tmp/repo/worktree",
      messages: [],
      draftAssistantText: "",
      draftAssistantMessageId: null,
      draftReasoningText: "",
      draftReasoningMessageId: null,
      contextUsage: null,
      pendingApprovals: [
        {
          requestId: "permission-1",
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
      todos: [],
      modelCatalog: null,
      selectedModel: null,
      isLoadingModelCatalog: false,
      promptOverrides: {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: { "external-1": existingSession },
    };
    let state: Record<string, AgentSessionState> = sessionsRef.current;
    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    hostModule.host.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:01.000Z",
        workingDirectory: "/tmp/repo/worktree",
        pendingApprovals: [
          {
            requestId: "permission-1",
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
    ];

    queryClient.setQueryData(runtimeQueryKeys.list("opencode", "/tmp/repo"), [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo/worktree",
        runtimeRoute: {
          type: "local_http",
          endpoint: "http://127.0.0.1:4444",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      } satisfies RuntimeInstanceSummary,
    ]);

    const loadAgentSessions = createLoadAgentSessions({
      queryClient,
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        loadSessionHistory: async () => [],
        listSessionPresence: async () => [
          {
            externalSessionId: "external-1",
            title: "Session",
            role: "build",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "idle" },
            pendingApprovals: [],
            pendingQuestions: [],
            workingDirectory: "/tmp/repo/worktree",
          },
        ],
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [createTaskFixture()] },
      updateSession: (externalSessionId, updater) => {
        const current = state[externalSessionId];
        if (!current) {
          return;
        }
        const next = updater(current);
        state = {
          ...state,
          [externalSessionId]: next,
        };
        sessionsRef.current = state;
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await loadAgentSessions("task-1", {
        mode: "requested_history",
        targetExternalSessionId: "external-1",
        historyPolicy: "requested_only",
        allowLiveSessionResume: true,
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
    }

    expect(state["external-1"]?.pendingApprovals).toEqual([]);
  });
});
