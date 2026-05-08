import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type AgentSessionPresenceSnapshot,
  type AgentSessionState,
  createAdapter,
  createLoadAgentSessions,
  createPresence,
  createTaskFixture,
  createTestQueryClient,
  getSession,
  type LegacyRunSummary,
  type LoadSessionHistoryInput,
  OPENCODE_RUNTIME_DESCRIPTOR,
  persistedSessionRecord,
  type RuntimeInstanceSummary,
  runtimeQueryKeys,
  sessionMessagesToArray,
  setupDefaultLoadSessionsHost,
} from "./load-sessions-test-harness";

let legacyHost!: { runsList: (repoPath?: string) => Promise<LegacyRunSummary[]> };

describe("agent-orchestrator requested session runtime hydration", () => {
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

  test("does not recover pending input from transcript history when no live snapshot exists", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "external-1": {
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
        workingDirectory: "/tmp/repo",
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
        loadSessionHistory: async () => [
          {
            messageId: "m-1",
            role: "assistant",
            timestamp: "2026-02-22T08:00:00.000Z",
            text: "Need permission",
            parts: [
              {
                kind: "tool",
                messageId: "m-1",
                partId: "p-1",
                callId: "call-1",
                tool: "permission",
                status: "running",
                metadata: {
                  requestId: "perm-from-history",
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
              },
            ],
          },
        ],
        listSessionPresence: async () => [],
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
        state = {
          ...state,
          [externalSessionId]: updater(current),
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
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
    }

    expect(state["external-1"]?.pendingApprovals).toEqual([]);
    expect(state["external-1"]?.pendingQuestions).toEqual([]);
  });

  test("hydrates requested session history from an explicit live repo runtime", async () => {
    const runtimeListCalls: string[] = [];
    const runsListCalls: string[] = [];
    const runtimeEnsureCalls: string[] = [];
    const hostModule = await import("../../shared/host");
    hostModule.host.runtimeList = async (_runtimeKind, repoPath) => {
      runtimeListCalls.push(repoPath);
      return [];
    };
    legacyHost.runsList = async (repoPath) => {
      runsListCalls.push(repoPath ?? "");
      return [];
    };
    hostModule.host.runtimeEnsure = async (repoPath) => {
      runtimeEnsureCalls.push(repoPath);
      return {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath,
        taskId: null,
        role: "workspace",
        workingDirectory: repoPath,
        runtimeRoute: {
          type: "local_http",
          endpoint: "http://127.0.0.1:9999",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      };
    };

    const existingSession: AgentSessionState = {
      externalSessionId: "external-live",
      taskId: "task-1",
      repoPath: "/tmp/repo",
      role: "build",
      status: "stopped",
      startedAt: "2026-02-22T08:00:00.000Z",
      runtimeKind: "opencode",
      runtimeId: "runtime-live",
      runId: "run-live",
      workingDirectory: "/tmp/repo/worktree",
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
    };
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: { "external-live": existingSession },
    };
    let state = sessionsRef.current;
    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };

    let historyLoadInput: {
      repoPath: string;
      runtimeKind: string;
      workingDirectory: string;
      externalSessionId: string;
    } | null = null;
    const loadAgentSessions = createLoadAgentSessions({
      queryClient,
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        loadSessionHistory: async (input: LoadSessionHistoryInput) => {
          historyLoadInput = {
            repoPath: input.repoPath,
            runtimeKind: input.runtimeKind,
            workingDirectory: input.workingDirectory,
            externalSessionId: input.externalSessionId,
          };
          return [];
        },
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [createTaskFixture()] },
      updateSession: (externalSessionId, updater) => {
        const current = sessionsRef.current[externalSessionId];
        if (!current) {
          return;
        }
        const nextSession = updater(current);
        sessionsRef.current = {
          ...sessionsRef.current,
          [externalSessionId]: nextSession,
        };
        state = sessionsRef.current;
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    await loadAgentSessions("task-1", {
      mode: "requested_history",
      targetExternalSessionId: "external-live",
      historyPolicy: "requested_only",
      persistedRecords: [
        persistedSessionRecord({
          runtimeKind: "opencode",
          externalSessionId: "external-live",
          taskId: "task-1",
          role: "build",
          status: "running",
          startedAt: "2026-02-22T08:00:00.000Z",
          updatedAt: "2026-02-22T08:00:00.000Z",
          workingDirectory: "/tmp/repo/worktree",
          pendingApprovals: [],
          pendingQuestions: [],
        }),
      ],
      preloadedRuntimeLists: new Map([
        [
          "opencode",
          [
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
          ],
        ],
      ]),
      preloadedSessionPresenceByKey: new Map([
        [
          "opencode::http://127.0.0.1:4444::/tmp/repo/worktree",
          [
            createPresence("external-live", "/tmp/repo/worktree", {
              title: "BUILD task-1",
              startedAt: "2026-02-22T08:00:00.000Z",
              status: { type: "busy" },
              pendingApprovals: [],
              pendingQuestions: [],
            }),
          ],
        ],
      ]) as Map<string, AgentSessionPresenceSnapshot[]>,
    });

    expect(historyLoadInput).not.toBeNull();
    expect(historyLoadInput).toMatchObject({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
      externalSessionId: "external-live",
    });
    expect(runtimeListCalls).toEqual([]);
    expect(runsListCalls).toEqual([]);
    expect(runtimeEnsureCalls).toEqual([]);
  });

  test("recovers a targeted session runtime attachment without hydrating history", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "external-1": {
          externalSessionId: "external-1",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "build",
          status: "stopped",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeKind: "opencode",
          runtimeId: null,
          runId: null,
          workingDirectory: "/tmp/repo/worktree",
          historyHydrationState: "not_requested",
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
    let state = sessionsRef.current;
    let historyLoads = 0;
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
      adapter: createAdapter({
        listSessionPresence: async () => [createPresence("external-1", "/tmp/repo/worktree")],
        loadSessionHistory: async () => {
          historyLoads += 1;
          return [];
        },
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
        state = {
          ...state,
          [externalSessionId]: updater(current),
        };
        sessionsRef.current = state;
      },
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
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo/worktree",
      }),
    ];
    const preloadedRuntimeLists = new Map<"opencode", RuntimeInstanceSummary[]>([
      [
        "opencode",
        [
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
        ],
      ],
    ]);

    try {
      await loadAgentSessions("task-1", {
        mode: "recover_runtime_attachment",
        targetExternalSessionId: "external-1",
        historyPolicy: "none",
        preloadedRuntimeLists,
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
    }

    expect(historyLoads).toBe(0);
    expect(getSession(state, "external-1").runId).toBeNull();
    expect(getSession(state, "external-1").runtimeId).toBe("runtime-1");
    expect(getSession(state, "external-1").historyHydrationState).toBe("not_requested");
    expect(sessionMessagesToArray(getSession(state, "external-1"))).toEqual([]);
  });
});
