import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type AgentSessionRecord,
  type AgentSessionState,
  createAdapter,
  createLoadAgentSessions,
  createPresence,
  createTaskFixture,
  createTestQueryClient,
  getSession,
  type LegacyRunSummary,
  type ListSessionPresenceInput,
  type LoadSessionHistoryInput,
  OPENCODE_RUNTIME_DESCRIPTOR,
  persistedSessionRecord,
  type RuntimeInstanceSummary,
  runtimeQueryKeys,
  type SessionLifecycleAdapter,
  sessionMessagesToArray,
  setupDefaultLoadSessionsHost,
} from "./load-sessions-test-harness";

type LoadSessionTodosInput = Parameters<
  NonNullable<SessionLifecycleAdapter["loadSessionTodos"]>
>[0];

let legacyHost!: { runsList: (repoPath?: string) => Promise<LegacyRunSummary[]> };

describe("agent-orchestrator load-session runtime policy", () => {
  let restoreDefaultHost: (() => void) | null = null;
  let queryClient!: ReturnType<typeof createTestQueryClient>;

  beforeEach(async () => {
    queryClient = createTestQueryClient();
    const hostDefaults = await setupDefaultLoadSessionsHost();
    legacyHost = hostDefaults.legacyHost;
    restoreDefaultHost = hostDefaults.restore;
  });

  afterEach(() => {
    queryClient.clear();
    restoreDefaultHost?.();
    restoreDefaultHost = null;
  });

  test("hydrates runtime pending permissions and questions for a requested live session", async () => {
    const setSessionsByIdCalls: Array<Record<string, AgentSessionState>> = [];
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "external-1": {
          externalSessionId: "external-session-1",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "build" as const,
          status: "running" as const,
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeId: null,
          runId: null,
          runtimeKind: "opencode" as const,
          workingDirectory: "/tmp/repo/worktree",
          messages: [],
          draftAssistantText: "",
          draftAssistantMessageId: null,
          draftReasoningText: "",
          draftReasoningMessageId: null,
          pendingApprovals: [],
          pendingQuestions: [],
          todos: [],
          modelCatalog: null,
          selectedModel: null,
          isLoadingModelCatalog: false,
        },
      },
    };

    const adapter = createAdapter({
      loadSessionHistory: async () => [
        {
          messageId: "m-1",
          role: "assistant",
          timestamp: "2026-02-22T08:00:00.000Z",
          text: "Waiting",
          parts: [],
        },
      ],
      listSessionPresence: async () => [
        {
          externalSessionId: "external-session-1",
          title: "BUILD task-1",
          workingDirectory: "/tmp/repo/worktree",
          startedAt: "2026-02-22T08:00:00.000Z",
          status: { type: "busy" },
          pendingApprovals: [
            {
              requestId: "perm-1",
              requestType: "permission_grant" as const,
              title: `Approve permission: ${"read"}`,
              summary: `Approval request for ${"read"}.`,
              affectedPaths: ["**/.env"],
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
                  question: "Ship it?",
                  options: [{ label: "Yes", description: "Approve" }],
                },
              ],
            },
          ],
        },
      ],
    });

    const loadAgentSessions = createLoadAgentSessions({
      queryClient,
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 0 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById: (updater) => {
        if (typeof updater === "function") {
          sessionsRef.current = updater(sessionsRef.current);
        } else {
          sessionsRef.current = updater;
        }
        setSessionsByIdCalls.push(sessionsRef.current);
      },
      taskRef: { current: [createTaskFixture()] },
      updateSession: (externalSessionId, updater) => {
        const current = sessionsRef.current[externalSessionId];
        if (!current) {
          return;
        }
        sessionsRef.current = {
          ...sessionsRef.current,
          [externalSessionId]: updater(current),
        };
      },
      attachSessionListener: () => {},
      loadRepoPromptOverrides: async () => ({}),
    });

    const record = persistedSessionRecord({
      runtimeKind: "opencode",
      externalSessionId: "external-session-1",
      taskId: "task-1",
      role: "build",
      status: "stopped",
      startedAt: "2026-02-22T08:00:00.000Z",
      updatedAt: "2026-02-22T08:00:00.000Z",
      workingDirectory: "/tmp/repo/worktree",
      pendingApprovals: [],
      pendingQuestions: [],
    });
    const hostRuntimeList: RuntimeInstanceSummary[] = [
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
      },
    ];

    await loadAgentSessions("task-1", {
      mode: "requested_history",
      targetExternalSessionId: "external-session-1",
      persistedRecords: [record],
      preloadedRuntimeLists: new Map([["opencode", hostRuntimeList]]),
      allowLiveSessionResume: true,
    });

    expect(setSessionsByIdCalls.length).toBeGreaterThan(0);
    expect(sessionsRef.current["external-session-1"]?.pendingApprovals).toEqual([
      {
        requestId: "perm-1",
        requestType: "permission_grant" as const,
        title: `Approve permission: ${"read"}`,
        summary: `Approval request for ${"read"}.`,
        affectedPaths: ["**/.env"],
        action: { name: "read" },
        mutation: "read_only" as const,
        supportedReplyOutcomes: [
          "approve_once" as const,
          "approve_session" as const,
          "reject" as const,
        ],
      },
    ]);
    expect(sessionsRef.current["external-session-1"]?.pendingQuestions).toEqual([
      {
        requestId: "question-1",
        questions: [
          {
            header: "Confirm",
            question: "Ship it?",
            options: [{ label: "Yes", description: "Approve" }],
          },
        ],
      },
    ]);
  });

  test("rejects hydration when a persisted session record is missing runtime metadata", async () => {
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
      updateSession: () => {},
      loadRepoPromptOverrides: async () => ({}),
    });

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    hostModule.host.agentSessionsList = async () => [
      {
        externalSessionId: "external-1",
        taskId: "task-1",
        repoPath: "/tmp/repo",
        role: "build",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo/worktree",
      } as unknown as AgentSessionRecord,
    ];

    try {
      await expect(
        loadAgentSessions("task-1", {
          mode: "requested_history",
          targetExternalSessionId: "external-1",
          historyPolicy: "requested_only",
        }),
      ).rejects.toThrow("Persisted session 'external-1' is missing runtime kind metadata.");
      expect(state["external-1"]?.messages ?? []).toEqual([]);
    } finally {
      hostModule.host.agentSessionsList = originalList;
    }
  });

  test("hydrates qa worktree sessions through the shared repo runtime", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let observedRuntimeEndpoint: string | null = null;

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
      const next = updater(current);
      observedRuntimeEndpoint = next.runtimeId;
      state = {
        ...state,
        [externalSessionId]: next,
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
    const originalRuntimeList = hostModule.host.runtimeList;
    hostModule.host.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        externalSessionId: "external-qa-1",
        taskId: "task-1",
        role: "qa",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo/worktree",
      }),
    ];
    hostModule.host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http",
          endpoint: "http://127.0.0.1:4444",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];

    try {
      await loadAgentSessions("task-1", {
        mode: "requested_history",
        targetExternalSessionId: "external-qa-1",
        historyPolicy: "requested_only",
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
    }

    expect(observedRuntimeEndpoint as string | null).toBeNull();
    expect(state["external-qa-1"]?.runtimeId).toBeNull();
    expect(state["external-qa-1"]?.workingDirectory).toBe("/tmp/repo/worktree");
    expect(sessionMessagesToArray(getSession(state, "external-qa-1")).length).toBeGreaterThan(0);
  });

  test("does not bind qa repo-root sessions to an existing workspace runtime", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    const ensuredRuntimeKinds: string[] = [];

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
    const originalRuntimeList = hostModule.host.runtimeList;
    const originalRunsList = legacyHost.runsList;
    const originalEnsure = hostModule.host.runtimeEnsure;
    hostModule.host.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        externalSessionId: "external-qa-root",
        taskId: "task-1",
        role: "qa",
        status: "stopped",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo/",
      }),
    ];
    hostModule.host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-root",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http",
          endpoint: "http://127.0.0.1:4555",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];
    legacyHost.runsList = async () => [];
    hostModule.host.runtimeEnsure = async (_repoPath, runtimeKind) => {
      ensuredRuntimeKinds.push(runtimeKind);
      return {
        kind: runtimeKind,
        runtimeId: "runtime-root",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4555",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: {
          ...OPENCODE_RUNTIME_DESCRIPTOR,
          kind: runtimeKind,
          label: "OpenCode",
          description: "Shared runtime",
        },
      };
    };

    try {
      await loadAgentSessions("task-1", {
        mode: "requested_history",
        targetExternalSessionId: "external-qa-root",
        historyPolicy: "requested_only",
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      legacyHost.runsList = originalRunsList;
      hostModule.host.runtimeEnsure = originalEnsure;
    }

    expect(ensuredRuntimeKinds).toEqual([]);
    expect(state["external-qa-root"]?.runtimeId).toBeNull();
    expect(
      state["external-qa-root"] ? sessionMessagesToArray(state["external-qa-root"]) : undefined,
    ).toHaveLength(1);
  });

  test("hydrates requested history without probing the runtime list cache", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    const presenceCalls: string[] = [];

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
      adapter: createAdapter({
        listSessionPresence: async () => {
          presenceCalls.push("list");
          throw new Error("requested history should not list live session presence");
        },
        readSessionPresence: async () => {
          presenceCalls.push("read");
          throw new Error("requested history should not read live session presence");
        },
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [createTaskFixture()] },
      updateSession,
      loadRepoPromptOverrides: async () => ({}),
    });

    const queryKey = runtimeQueryKeys.list("opencode", "/tmp/repo");
    queryClient.setQueryData(queryKey, []);

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRuntimeList = hostModule.host.runtimeList;
    const originalRunsList = legacyHost.runsList;
    const originalEnsure = hostModule.host.runtimeEnsure;
    hostModule.host.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      }),
    ];
    hostModule.host.runtimeList = async () => [];
    legacyHost.runsList = async () => [];
    const runtimeEnsureCalls: string[] = [];
    hostModule.host.runtimeEnsure = async (repoPath) => {
      runtimeEnsureCalls.push(repoPath);
      throw new Error("runtimeEnsure should not be called during hydration");
    };

    try {
      await loadAgentSessions("task-1", {
        mode: "requested_history",
        targetExternalSessionId: "external-1",
        historyPolicy: "requested_only",
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      legacyHost.runsList = originalRunsList;
      hostModule.host.runtimeEnsure = originalEnsure;
    }

    expect(runtimeEnsureCalls).toEqual([]);
    expect(presenceCalls).toEqual([]);
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
    expect(state["external-1"]?.historyHydrationState).toBe("hydrated");
  });

  test("hydrates requested history, todos, and status from the persisted session runtime", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "external-build-worktree": {
          externalSessionId: "external-build-worktree",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "build",
          status: "running",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeKind: "opencode",
          runtimeId: "runtime-build-worktree",
          workingDirectory: "/tmp/repo/worktrees/task-1",
          historyHydrationState: "not_requested",
          runtimeRecoveryState: "idle",
          messages: [],
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
        },
      },
    };
    let state: Record<string, AgentSessionState> = sessionsRef.current;
    const historyInputs: LoadSessionHistoryInput[] = [];
    const todosInputs: LoadSessionTodosInput[] = [];
    const statusInputs: ListSessionPresenceInput[] = [];
    const runtimeEnsureCalls: string[] = [];

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
      adapter: createAdapter({
        loadSessionHistory: async (input) => {
          historyInputs.push(input);
          return [];
        },
        loadSessionTodos: async (input) => {
          todosInputs.push(input);
          return [];
        },
        listSessionPresence: async (input) => {
          statusInputs.push(input);
          return [
            createPresence("external-build-worktree", "/tmp/repo/worktrees/task-1", {
              status: { type: "idle" },
            }),
          ];
        },
        readSessionPresence: async (input) => {
          return createPresence(input.externalSessionId, input.workingDirectory, {
            status: { type: "idle" },
          });
        },
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [createTaskFixture()] },
      updateSession,
      loadRepoPromptOverrides: async () => ({}),
    });

    const hostModule = await import("../../shared/host");
    const originalRuntimeList = hostModule.host.runtimeList;
    const originalEnsure = hostModule.host.runtimeEnsure;
    hostModule.host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-repo-default",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http",
          endpoint: "http://127.0.0.1:4999",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];
    hostModule.host.runtimeEnsure = async (repoPath) => {
      runtimeEnsureCalls.push(repoPath);
      throw new Error("runtimeEnsure should not be called during requested-history hydration");
    };

    try {
      await loadAgentSessions("task-1", {
        mode: "requested_history",
        targetExternalSessionId: "external-build-worktree",
        historyPolicy: "requested_only",
        persistedRecords: [
          persistedSessionRecord({
            runtimeKind: "opencode",
            externalSessionId: "external-build-worktree",
            taskId: "task-1",
            role: "build",
            status: "running",
            startedAt: "2026-02-22T08:00:00.000Z",
            updatedAt: "2026-02-22T08:00:00.000Z",
            workingDirectory: "/tmp/repo/worktrees/task-1",
          }),
        ],
      });
    } finally {
      hostModule.host.runtimeList = originalRuntimeList;
      hostModule.host.runtimeEnsure = originalEnsure;
    }

    expect(runtimeEnsureCalls).toEqual([]);
    expect(historyInputs.map((input) => input.workingDirectory)).toEqual([
      "/tmp/repo/worktrees/task-1",
    ]);
    expect(todosInputs.map((input) => input.workingDirectory)).toEqual([
      "/tmp/repo/worktrees/task-1",
    ]);
    expect(statusInputs.map((input) => input.directories)).toEqual([
      ["/tmp/repo/worktrees/task-1"],
    ]);
    expect(getSession(state, "external-build-worktree").status).toBe("idle");
  });

  test("hydrates build worktree sessions through the shared repo runtime", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    const ensuredRuntimeKinds: string[] = [];

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
      const next = updater(current);
      state = {
        ...state,
        [externalSessionId]: next,
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
    const originalRuntimeList = hostModule.host.runtimeList;
    const originalRunsList = legacyHost.runsList;
    const originalEnsure = hostModule.host.runtimeEnsure;
    hostModule.host.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo/conflict-worktree",
      }),
    ];
    hostModule.host.runtimeList = (async (): Promise<RuntimeInstanceSummary[]> => [
      {
        kind: "opencode",
        runtimeId: "runtime-shared",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http",
          endpoint: "http://127.0.0.1:4666",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ]) as typeof hostModule.host.runtimeList;
    legacyHost.runsList = async () => [];
    hostModule.host.runtimeEnsure = async (_repoPath, runtimeKind) => {
      ensuredRuntimeKinds.push(runtimeKind);
      return {
        kind: runtimeKind,
        runtimeId: "runtime-shared",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4666",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      };
    };

    try {
      await loadAgentSessions("task-1", {
        mode: "requested_history",
        targetExternalSessionId: "external-1",
        historyPolicy: "requested_only",
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      legacyHost.runsList = originalRunsList;
      hostModule.host.runtimeEnsure = originalEnsure;
    }

    expect(ensuredRuntimeKinds).toEqual([]);
    expect(state["external-1"]?.runtimeId).toBeNull();
    expect(state["external-1"]?.workingDirectory).toBe("/tmp/repo/conflict-worktree");
    expect(sessionMessagesToArray(getSession(state, "external-1")).length).toBeGreaterThan(0);
  });

  test("hydrates qa worktree history without ensuring a shared workspace runtime", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    const ensuredRuntimeKinds: string[] = [];

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
    const originalRuntimeList = hostModule.host.runtimeList;
    const originalRunsList = legacyHost.runsList;
    const originalEnsure = hostModule.host.runtimeEnsure;
    hostModule.host.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        externalSessionId: "external-qa-worktree",
        taskId: "task-1",
        role: "qa",
        status: "stopped",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo/worktrees/task-1",
      }),
    ];
    hostModule.host.runtimeList = async () => [];
    legacyHost.runsList = async () => [];
    hostModule.host.runtimeEnsure = async (_repoPath, runtimeKind) => {
      ensuredRuntimeKinds.push(runtimeKind);
      return {
        kind: runtimeKind,
        runtimeId: "runtime-shared",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4777",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      };
    };

    try {
      await loadAgentSessions("task-1", {
        mode: "requested_history",
        targetExternalSessionId: "external-qa-worktree",
        historyPolicy: "requested_only",
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      legacyHost.runsList = originalRunsList;
      hostModule.host.runtimeEnsure = originalEnsure;
    }

    expect(ensuredRuntimeKinds).toEqual([]);
    expect(state["external-qa-worktree"]?.runtimeId).toBeNull();
    expect(state["external-qa-worktree"]?.historyHydrationState).toBe("hydrated");
  });
});
