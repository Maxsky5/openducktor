import { beforeEach, describe, expect, test } from "bun:test";
import type { AgentSessionRecord, RuntimeInstanceSummary } from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { appQueryClient, clearAppQueryClient } from "@/lib/query-client";
import { runtimeQueryKeys } from "@/state/queries/runtime";
import {
  findSessionMessageForTest,
  sessionMessageAt,
  sessionMessagesToArray,
  someSessionMessageForTest,
} from "@/test-utils/session-message-test-helpers";
import type { AgentSessionState as BaseAgentSessionState } from "@/types/agent-orchestrator";
import { createDeferred, createTaskCardFixture } from "../test-utils";
import { liveAgentSessionLookupKey } from "./live-agent-session-cache";
import { LiveAgentSessionStore } from "./live-agent-session-store";
import { createLoadAgentSessions } from "./load-sessions";

type AgentSessionState = BaseAgentSessionState & { runId?: string | null };

type LegacyRunSummary = { runId: string; worktreePath: string };

let legacyHost!: { runsList: (repoPath?: string) => Promise<LegacyRunSummary[]> };

const taskFixture = createTaskCardFixture({ title: "Task" });

const getSession = (
  state: Record<string, AgentSessionState>,
  sessionId: string,
): AgentSessionState => {
  const session = state[sessionId];
  if (!session) {
    throw new Error(`Expected session ${sessionId}`);
  }
  return session;
};

const persistedSessionRecord = (
  input: {
    sessionId: string;
    externalSessionId: string;
    role: AgentSessionRecord["role"];
    scenario: AgentSessionRecord["scenario"];
    startedAt: string;
    workingDirectory: string;
    runtimeKind?: AgentSessionRecord["runtimeKind"];
    selectedModel?: AgentSessionRecord["selectedModel"];
  } & Record<string, unknown>,
): AgentSessionRecord => ({
  runtimeKind: input.runtimeKind ?? "opencode",
  sessionId: input.sessionId,
  externalSessionId: input.externalSessionId,
  role: input.role,
  scenario: input.scenario,
  startedAt: input.startedAt,
  workingDirectory: input.workingDirectory,
  selectedModel: input.selectedModel ?? null,
});

const createAdapter = (
  overrides: Partial<Parameters<typeof createLoadAgentSessions>[0]["adapter"]> = {},
): Parameters<typeof createLoadAgentSessions>[0]["adapter"] => ({
  hasSession: () => false,
  listLiveAgentSessionSnapshots: async () => [],
  loadSessionHistory: async () => [],
  resumeSession: async (input) => ({
    sessionId: input.sessionId,
    externalSessionId: input.externalSessionId,
    role: input.role,
    scenario: input.scenario,
    startedAt: "2026-02-22T08:00:00.000Z",
    status: "idle",
    runtimeKind: input.runtimeKind,
  }),
  ...overrides,
});

describe("agent-orchestrator-load-sessions", () => {
  beforeEach(async () => {
    await clearAppQueryClient();
    const hostModule = await import("../../shared/host");
    legacyHost = hostModule.host as typeof hostModule.host & {
      runsList: (repoPath?: string) => Promise<LegacyRunSummary[]>;
    };
    hostModule.host.runtimeList = async () => [];
    legacyHost.runsList = async () => [];
    hostModule.host.runtimeEnsure = async (repoPath) => ({
      kind: "opencode",
      runtimeId: "runtime-1",
      repoPath,
      taskId: null,
      role: "workspace",
      workingDirectory: repoPath,
      runtimeRoute: {
        type: "local_http",
        endpoint: "http://127.0.0.1:4444",
      },
      startedAt: "2026-02-22T08:00:00.000Z",
      descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
    });
  });

  test("no-ops when active repo is missing", async () => {
    let setCalled = false;
    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: null,
      adapter: createAdapter(),
      repoEpochRef: { current: 0 },
      currentWorkspaceRepoPathRef: { current: null },
      sessionsRef: { current: {} },
      setSessionsById: () => {
        setCalled = true;
      },
      taskRef: { current: [taskFixture] },
      updateSession: () => {},
      loadRepoPromptOverrides: async () => ({}),
    });

    await loadAgentSessions("task-1");

    expect(setCalled).toBe(false);
  });

  test("no-ops for blank task ids", async () => {
    let setCalled = false;
    const loadAgentSessions = createLoadAgentSessions({
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
      taskRef: { current: [taskFixture] },
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
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
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
      taskRef: { current: [taskFixture] },
      updateSession,
      loadRepoPromptOverrides: async () => ({}),
    });

    const originalList = (await import("../../shared/host")).host.agentSessionsList;
    (await import("../../shared/host")).host.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
        pendingPermissions: [{ requestId: "permission-1", permission: "read", patterns: ["**/*"] }],
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

    expect(Object.keys(state)).toContain("session-1");
    expect(state["session-1"]?.status).toBe("stopped");
    expect(state["session-1"]?.pendingPermissions).toEqual([]);
    expect(state["session-1"]?.pendingQuestions).toEqual([]);
  });

  test("does not merge persisted pending input into an existing session entry", async () => {
    const existingSession: AgentSessionState = {
      sessionId: "session-1",
      externalSessionId: "external-1",
      taskId: "task-1",
      repoPath: "/tmp/repo",
      role: "build",
      scenario: "build_implementation_start",
      status: "idle",
      startedAt: "2026-02-22T08:00:00.000Z",
      runtimeKind: "opencode",
      runtimeId: null,
      runId: null,
      runtimeRoute: null,
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
      pendingPermissions: [],
      pendingQuestions: [],
      todos: [],
      modelCatalog: null,
      selectedModel: null,
      isLoadingModelCatalog: false,
      promptOverrides: {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: { "session-1": existingSession },
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
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
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
      taskRef: { current: [taskFixture] },
      updateSession,
      loadRepoPromptOverrides: async () => ({}),
    });

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    hostModule.host.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:02.000Z",
        workingDirectory: "/tmp/repo",
        pendingPermissions: [{ requestId: "permission-1", permission: "read", patterns: ["**/*"] }],
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

    expect(state["session-1"] ? sessionMessagesToArray(state["session-1"]) : undefined).toEqual(
      sessionMessagesToArray(existingSession),
    );
    expect(state["session-1"]?.pendingPermissions).toEqual([]);
    expect(state["session-1"]?.pendingQuestions).toEqual([]);
  });

  test("clears pending permissions when the live snapshot reports no pending input", async () => {
    const existingSession: AgentSessionState = {
      sessionId: "session-1",
      externalSessionId: "external-1",
      taskId: "task-1",
      repoPath: "/tmp/repo",
      role: "build",
      scenario: "build_implementation_start",
      status: "idle",
      startedAt: "2026-02-22T08:00:00.000Z",
      runtimeKind: "opencode",
      runtimeId: null,
      runId: null,
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
      workingDirectory: "/tmp/repo/worktree",
      messages: [],
      draftAssistantText: "",
      draftAssistantMessageId: null,
      draftReasoningText: "",
      draftReasoningMessageId: null,
      contextUsage: null,
      pendingPermissions: [{ requestId: "permission-1", permission: "read", patterns: [".env"] }],
      pendingQuestions: [],
      todos: [],
      modelCatalog: null,
      selectedModel: null,
      isLoadingModelCatalog: false,
      promptOverrides: {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: { "session-1": existingSession },
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
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:01.000Z",
        workingDirectory: "/tmp/repo/worktree",
        pendingPermissions: [{ requestId: "permission-1", permission: "read", patterns: [".env"] }],
      }),
    ];

    appQueryClient.setQueryData(runtimeQueryKeys.list("opencode", "/tmp/repo"), [
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
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        loadSessionHistory: async () => [],
        listLiveAgentSessionSnapshots: async () => [
          {
            externalSessionId: "external-1",
            title: "Session",
            role: "build",
            scenario: "build_implementation_start",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "idle" },
            pendingPermissions: [],
            pendingQuestions: [],
            workingDirectory: "/tmp/repo/worktree",
          },
        ],
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession: (sessionId, updater) => {
        const current = state[sessionId];
        if (!current) {
          return;
        }
        const next = updater(current);
        state = {
          ...state,
          [sessionId]: next,
        };
        sessionsRef.current = state;
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await loadAgentSessions("task-1", {
        mode: "requested_history",
        targetSessionId: "session-1",
        historyPolicy: "requested_only",
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
    }

    expect(state["session-1"]?.pendingPermissions).toEqual([]);
  });

  test("does not recover pending input from transcript history when no live snapshot exists", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": {
          sessionId: "session-1",
          externalSessionId: "external-1",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "build",
          scenario: "build_implementation_start",
          status: "idle",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeKind: "opencode",
          runtimeId: null,
          runId: null,
          runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
          workingDirectory: "/tmp/repo/worktree",
          messages: [],
          draftAssistantText: "",
          draftAssistantMessageId: null,
          draftReasoningText: "",
          draftReasoningMessageId: null,
          contextUsage: null,
          pendingPermissions: [],
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
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:01.000Z",
        workingDirectory: "/tmp/repo/worktree",
        pendingPermissions: [{ requestId: "permission-1", permission: "read", patterns: [".env"] }],
      }),
    ];

    appQueryClient.setQueryData(runtimeQueryKeys.list("opencode", "/tmp/repo"), [
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
                  permission: "read",
                  patterns: ["**/.env"],
                },
              },
            ],
          },
        ],
        listLiveAgentSessionSnapshots: async () => [],
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession: (sessionId, updater) => {
        const current = state[sessionId];
        if (!current) {
          return;
        }
        state = {
          ...state,
          [sessionId]: updater(current),
        };
        sessionsRef.current = state;
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await loadAgentSessions("task-1", {
        mode: "requested_history",
        targetSessionId: "session-1",
        historyPolicy: "requested_only",
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
    }

    expect(state["session-1"]?.pendingPermissions).toEqual([]);
    expect(state["session-1"]?.pendingQuestions).toEqual([]);
  });

  test("hydrates requested session history from the current live runtime without re-resolving runtimes", async () => {
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
      sessionId: "session-live",
      externalSessionId: "external-live",
      taskId: "task-1",
      repoPath: "/tmp/repo",
      role: "build",
      scenario: "build_implementation_start",
      status: "stopped",
      startedAt: "2026-02-22T08:00:00.000Z",
      runtimeKind: "opencode",
      runtimeId: "runtime-live",
      runId: "run-live",
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
      workingDirectory: "/tmp/repo/worktree",
      messages: [],
      draftAssistantText: "",
      draftAssistantMessageId: null,
      draftReasoningText: "",
      draftReasoningMessageId: null,
      contextUsage: null,
      pendingPermissions: [],
      pendingQuestions: [],
      todos: [],
      modelCatalog: null,
      selectedModel: null,
      isLoadingModelCatalog: false,
      promptOverrides: {},
    };
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: { "session-live": existingSession },
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
      runtimeKind: string;
      endpoint: string;
      workingDirectory: string;
      externalSessionId: string;
    } | null = null;
    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        loadSessionHistory: async (input) => {
          historyLoadInput = {
            runtimeKind: input.runtimeKind,
            endpoint:
              input.runtimeConnection.type === "local_http" ? input.runtimeConnection.endpoint : "",
            workingDirectory: input.runtimeConnection.workingDirectory,
            externalSessionId: input.externalSessionId,
          };
          return [];
        },
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        const nextSession = updater(current);
        sessionsRef.current = {
          ...sessionsRef.current,
          [sessionId]: nextSession,
        };
        state = sessionsRef.current;
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    await loadAgentSessions("task-1", {
      mode: "requested_history",
      targetSessionId: "session-live",
      historyPolicy: "requested_only",
      persistedRecords: [
        persistedSessionRecord({
          runtimeKind: "opencode",
          sessionId: "session-live",
          externalSessionId: "external-live",
          taskId: "task-1",
          role: "build",
          scenario: "build_implementation_start",
          status: "running",
          startedAt: "2026-02-22T08:00:00.000Z",
          updatedAt: "2026-02-22T08:00:00.000Z",
          workingDirectory: "/tmp/repo/worktree",
          pendingPermissions: [],
          pendingQuestions: [],
        }),
      ],
      preloadedLiveAgentSessionsByKey: new Map([
        [
          "opencode::http://127.0.0.1:4444::/tmp/repo/worktree",
          [
            {
              externalSessionId: "external-live",
              title: "BUILD task-1",
              workingDirectory: "/tmp/repo/worktree",
              startedAt: "2026-02-22T08:00:00.000Z",
              status: { type: "busy" },
              pendingPermissions: [],
              pendingQuestions: [],
            },
          ],
        ],
      ]),
    });

    expect(historyLoadInput).not.toBeNull();
    expect(historyLoadInput).toMatchObject({
      runtimeKind: "opencode",
      endpoint: "http://127.0.0.1:4444",
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
        "session-1": {
          sessionId: "session-1",
          externalSessionId: "external-1",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "build",
          scenario: "build_implementation_start",
          status: "stopped",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeKind: "opencode",
          runtimeId: null,
          runId: null,
          runtimeRoute: null,
          workingDirectory: "/tmp/repo/worktree",
          historyHydrationState: "not_requested",
          messages: [],
          draftAssistantText: "",
          draftAssistantMessageId: null,
          draftReasoningText: "",
          draftReasoningMessageId: null,
          contextUsage: null,
          pendingPermissions: [],
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
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        loadSessionHistory: async () => {
          historyLoads += 1;
          return [];
        },
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession: (sessionId, updater) => {
        const current = state[sessionId];
        if (!current) {
          return;
        }
        state = {
          ...state,
          [sessionId]: updater(current),
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
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
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
    ]);

    try {
      await loadAgentSessions("task-1", {
        mode: "recover_runtime_attachment",
        targetSessionId: "session-1",
        historyPolicy: "none",
        preloadedRuntimeLists,
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
    }

    expect(historyLoads).toBe(0);
    expect(getSession(state, "session-1").runId).toBeNull();
    expect(getSession(state, "session-1").runtimeId).toBe("runtime-1");
    expect(getSession(state, "session-1").runtimeRoute).toEqual({
      type: "local_http",
      endpoint: "http://127.0.0.1:4444",
    });
    expect(getSession(state, "session-1").historyHydrationState).toBe("not_requested");
    expect(sessionMessagesToArray(getSession(state, "session-1"))).toEqual([]);
  });

  test("composes bootstrap, requested history hydration, and live reconciliation without cross-mode regressions", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let attachedToAdapter = false;
    let liveSnapshotLoads = 0;
    let historyLoads = 0;
    let resumeCalls = 0;
    let attachedListeners = 0;
    let promptOverrideLoads = 0;

    const persistedRecords = [
      persistedSessionRecord({
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
        scenario: "planner_initial",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      }),
    ];
    const runtimeLists = new Map<"opencode", RuntimeInstanceSummary[]>([
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
    ]);

    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };
    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        hasSession: () => attachedToAdapter,
        listLiveAgentSessionSnapshots: async () => {
          liveSnapshotLoads += 1;
          return [
            {
              externalSessionId: "external-1",
              title: "PLANNER task-1",
              role: "planner",
              scenario: "planner_initial",
              workingDirectory: "/tmp/repo",
              startedAt: "2026-02-22T08:00:00.000Z",
              status: { type: "busy" },
              pendingPermissions: [
                { requestId: "permission-live", permission: "read", patterns: ["README.md"] },
              ],
              pendingQuestions: [
                {
                  requestId: "question-live",
                  questions: [
                    {
                      header: "Confirm",
                      question: "Continue?",
                      options: [{ label: "Yes", description: "Proceed" }],
                    },
                  ],
                },
              ],
            },
          ];
        },
        loadSessionHistory: async () => {
          historyLoads += 1;
          return [
            {
              messageId: "history-1",
              role: "assistant",
              timestamp: "2026-02-22T08:00:01.000Z",
              text: "Requested history",
              parts: [
                {
                  kind: "text",
                  messageId: "history-1",
                  partId: "part-1",
                  text: "Requested history",
                  completed: true,
                },
              ],
            },
          ];
        },
        resumeSession: async (input) => {
          resumeCalls += 1;
          attachedToAdapter = true;
          return {
            sessionId: input.sessionId,
            externalSessionId: input.externalSessionId,
            role: input.role,
            scenario: input.scenario,
            startedAt: "2026-02-22T08:00:00.000Z",
            status: "running",
            runtimeKind: input.runtimeKind,
          };
        },
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      attachSessionListener: () => {
        attachedListeners += 1;
      },
      loadRepoPromptOverrides: async () => {
        promptOverrideLoads += 1;
        return {};
      },
      loadTaskDocuments: async () => ({
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
    });

    await loadAgentSessions("task-1", {
      mode: "bootstrap",
      persistedRecords,
      preloadedRuntimeLists: runtimeLists,
      historyPolicy: "none",
    });

    expect(state["session-1"]).toMatchObject({
      status: "stopped",
      runtimeRoute: null,
      messages: [],
      pendingPermissions: [],
      pendingQuestions: [],
    });
    expect(historyLoads).toBe(0);
    expect(resumeCalls).toBe(0);
    expect(attachedListeners).toBe(0);
    expect(promptOverrideLoads).toBe(0);

    await loadAgentSessions("task-1", {
      mode: "requested_history",
      targetSessionId: "session-1",
      persistedRecords,
      preloadedRuntimeLists: runtimeLists,
      historyPolicy: "requested_only",
    });

    const hydratedSession = state["session-1"];
    expect(hydratedSession).toMatchObject({
      status: "running",
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
      historyHydrationState: "hydrated",
      pendingPermissions: [
        { requestId: "permission-live", permission: "read", patterns: ["README.md"] },
      ],
    });
    expect(hydratedSession?.pendingQuestions).toHaveLength(1);
    expect(
      hydratedSession
        ? sessionMessagesToArray(hydratedSession).map((message) => message.content)
        : [],
    ).toEqual([
      "Session started (planner - planner_initial)",
      expect.stringContaining("System prompt:"),
      "Requested history",
    ]);
    expect(historyLoads).toBe(1);
    expect(resumeCalls).toBe(0);
    expect(attachedListeners).toBe(0);

    const hydratedMessageIds = hydratedSession
      ? sessionMessagesToArray(hydratedSession).map((message) => message.id)
      : [];

    await loadAgentSessions("task-1", {
      mode: "reconcile_live",
      persistedRecords,
      preloadedRuntimeLists: runtimeLists,
      historyPolicy: "live_if_empty",
    });

    expect(historyLoads).toBe(1);
    expect(resumeCalls).toBe(1);
    expect(attachedListeners).toBe(1);
    expect(liveSnapshotLoads).toBe(2);
    expect(
      sessionMessagesToArray(getSession(state, "session-1")).map((message) => message.id),
    ).toEqual(hydratedMessageIds);
    expect(state["session-1"]).toMatchObject({
      status: "running",
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
      historyHydrationState: "hydrated",
      pendingPermissions: [
        { requestId: "permission-live", permission: "read", patterns: ["README.md"] },
      ],
    });
    expect(state["session-1"]?.pendingQuestions).toHaveLength(1);
    expect(promptOverrideLoads).toBe(2);
  });

  test("hydrates transcript history after live reattach when reconcile uses live_if_empty", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let attachedToAdapter = false;
    let historyLoads = 0;
    let resumeCalls = 0;

    const persistedRecords = [
      persistedSessionRecord({
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
        scenario: "planner_initial",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      }),
    ];
    const runtimeLists = new Map<"opencode", RuntimeInstanceSummary[]>([
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
    ]);

    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };
    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        hasSession: () => attachedToAdapter,
        listLiveAgentSessionSnapshots: async () => [
          {
            externalSessionId: "external-1",
            title: "PLANNER task-1",
            role: "planner",
            scenario: "planner_initial",
            workingDirectory: "/tmp/repo",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
            pendingPermissions: [],
            pendingQuestions: [],
          },
        ],
        loadSessionHistory: async () => {
          historyLoads += 1;
          return [
            {
              messageId: "history-1",
              role: "assistant",
              timestamp: "2026-02-22T08:00:01.000Z",
              text: "Hydrated from reconcile",
              parts: [
                {
                  kind: "text",
                  messageId: "history-1",
                  partId: "part-1",
                  text: "Hydrated from reconcile",
                  completed: true,
                },
              ],
            },
          ];
        },
        resumeSession: async (input) => {
          resumeCalls += 1;
          attachedToAdapter = true;
          return {
            sessionId: input.sessionId,
            externalSessionId: input.externalSessionId,
            role: input.role,
            scenario: input.scenario,
            startedAt: "2026-02-22T08:00:00.000Z",
            status: "running",
            runtimeKind: input.runtimeKind,
          };
        },
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      attachSessionListener: () => {},
      loadRepoPromptOverrides: async () => ({}),
      loadTaskDocuments: async () => ({
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
    });

    await loadAgentSessions("task-1", {
      mode: "reconcile_live",
      persistedRecords,
      preloadedRuntimeLists: runtimeLists,
      historyPolicy: "live_if_empty",
    });

    expect(resumeCalls).toBe(1);
    expect(historyLoads).toBe(1);
    expect(state["session-1"]?.historyHydrationState).toBe("hydrated");
    expect(
      sessionMessagesToArray(getSession(state, "session-1")).map((message) => message.content),
    ).toEqual([
      "Session started (planner - planner_initial)",
      expect.stringContaining("System prompt:"),
      "Hydrated from reconcile",
    ]);
  });

  test("does not resume a live session after the repo changes while prompt overrides are loading", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let resumeCalls = 0;
    const repoEpochRef = { current: 2 };
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    const promptOverridesDeferred = createDeferred<Record<string, never>>();

    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };
    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        hasSession: () => false,
        listLiveAgentSessionSnapshots: async () => [
          {
            externalSessionId: "external-1",
            title: "PLANNER task-1",
            role: "planner",
            scenario: "planner_initial",
            workingDirectory: "/tmp/repo",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
            pendingPermissions: [],
            pendingQuestions: [],
          },
        ],
        resumeSession: async (input) => {
          resumeCalls += 1;
          return {
            sessionId: input.sessionId,
            externalSessionId: input.externalSessionId,
            role: input.role,
            scenario: input.scenario,
            startedAt: "2026-02-22T08:00:00.000Z",
            status: "running",
            runtimeKind: input.runtimeKind,
          };
        },
      }),
      repoEpochRef,
      currentWorkspaceRepoPathRef,
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      attachSessionListener: () => {
        throw new Error("should not attach stale session");
      },
      loadRepoPromptOverrides: async () => promptOverridesDeferred.promise,
      loadTaskDocuments: async () => ({
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
    });

    const loadPromise = loadAgentSessions("task-1", {
      mode: "reconcile_live",
      persistedRecords: [
        persistedSessionRecord({
          runtimeKind: "opencode",
          sessionId: "session-1",
          externalSessionId: "external-1",
          taskId: "task-1",
          role: "planner",
          scenario: "planner_initial",
          startedAt: "2026-02-22T08:00:00.000Z",
          updatedAt: "2026-02-22T08:00:00.000Z",
          workingDirectory: "/tmp/repo",
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
      historyPolicy: "none",
    });

    repoEpochRef.current = 3;
    currentWorkspaceRepoPathRef.current = "/tmp/other-repo";
    promptOverridesDeferred.resolve({});
    await loadPromise;

    expect(resumeCalls).toBe(0);
    expect(state["session-1"]?.runtimeRoute).toBeUndefined();
  });

  test("reuses the trusted live agent session store for requested session hydration", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": {
          sessionId: "session-1",
          externalSessionId: "external-1",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          runtimeKind: "opencode",
          role: "build",
          scenario: "build_implementation_start",
          status: "idle",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeId: "runtime-1",
          runId: "run-1",
          runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
          workingDirectory: "/tmp/repo/worktree",
          messages: [],
          draftAssistantText: "",
          draftAssistantMessageId: null,
          draftReasoningText: "",
          draftReasoningMessageId: null,
          pendingPermissions: [],
          pendingQuestions: [],
          todos: [],
          modelCatalog: null,
          selectedModel: null,
          isLoadingModelCatalog: false,
        },
      },
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

    const liveAgentSessionStore = new LiveAgentSessionStore();
    liveAgentSessionStore.replaceRepoSnapshots(
      "/tmp/repo",
      new Map([
        [
          liveAgentSessionLookupKey(
            "opencode",
            {
              type: "local_http",
              endpoint: "http://127.0.0.1:4444",
              workingDirectory: "/tmp/repo/worktree",
            },
            "/tmp/repo/worktree",
          ),
          [
            {
              externalSessionId: "external-1",
              title: "BUILD task-1",
              workingDirectory: "/tmp/repo/worktree",
              startedAt: "2026-02-22T08:00:00.000Z",
              status: { type: "busy" },
              pendingPermissions: [],
              pendingQuestions: [],
            },
          ],
        ],
      ]),
    );

    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        listLiveAgentSessionSnapshots: async () => {
          throw new Error("should not reload live snapshots");
        },
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession: (sessionId, updater) => {
        const currentSession = state[sessionId];
        if (!currentSession) {
          throw new Error(`Missing session '${sessionId}' in test state.`);
        }
        setSessionsById((current) => ({
          ...current,
          [sessionId]: updater(currentSession),
        }));
      },
      loadRepoPromptOverrides: async () => ({}),
      liveAgentSessionStore,
    });

    await loadAgentSessions("task-1", {
      mode: "requested_history",
      targetSessionId: "session-1",
      persistedRecords: [
        persistedSessionRecord({
          runtimeKind: "opencode",
          sessionId: "session-1",
          externalSessionId: "external-1",
          taskId: "task-1",
          role: "build",
          scenario: "build_implementation_start",
          startedAt: "2026-02-22T08:00:00.000Z",
          updatedAt: "2026-02-22T08:00:00.000Z",
          workingDirectory: "/tmp/repo/worktree",
        }),
      ],
    });

    expect(state["session-1"]?.status).toBe("running");
  });

  test("refreshes requested session history even when in-memory messages already exist", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-live": {
          sessionId: "session-live",
          externalSessionId: "external-live",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "build",
          scenario: "build_implementation_start",
          status: "running",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeKind: "opencode",
          runtimeId: "runtime-live",
          runId: null,
          runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
          workingDirectory: "/tmp/repo/worktree",
          messages: [
            {
              id: "stale-message",
              role: "assistant",
              content: "stale",
              timestamp: "2026-02-22T08:00:00.000Z",
              meta: { kind: "assistant", agentRole: "build", isFinal: true },
            },
          ],
          draftAssistantText: "",
          draftAssistantMessageId: null,
          draftReasoningText: "",
          draftReasoningMessageId: null,
          contextUsage: null,
          pendingPermissions: [],
          pendingQuestions: [],
          todos: [],
          modelCatalog: null,
          selectedModel: null,
          isLoadingModelCatalog: false,
          promptOverrides: {},
        },
      },
    };
    let historyLoads = 0;
    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        loadSessionHistory: async () => {
          historyLoads += 1;
          return [];
        },
        listLiveAgentSessionSnapshots: async () => [
          {
            externalSessionId: "external-live",
            title: "BUILD task-1",
            workingDirectory: "/tmp/repo/worktree",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
            pendingPermissions: [],
            pendingQuestions: [],
          },
        ],
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById: (updater) => {
        sessionsRef.current =
          typeof updater === "function" ? updater(sessionsRef.current) : updater;
      },
      taskRef: { current: [taskFixture] },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current = {
          ...sessionsRef.current,
          [sessionId]: updater(current),
        };
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    await loadAgentSessions("task-1", {
      mode: "requested_history",
      targetSessionId: "session-live",
      historyPolicy: "requested_only",
      persistedRecords: [
        persistedSessionRecord({
          runtimeKind: "opencode",
          sessionId: "session-live",
          externalSessionId: "external-live",
          taskId: "task-1",
          role: "build",
          scenario: "build_implementation_start",
          status: "running",
          startedAt: "2026-02-22T08:00:00.000Z",
          updatedAt: "2026-02-22T08:00:00.000Z",
          workingDirectory: "/tmp/repo/worktree",
          pendingPermissions: [],
          pendingQuestions: [],
        }),
      ],
    });

    expect(historyLoads).toBe(1);
  });

  test("uses the resolved working directory for requested-history live lookups and state updates", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": {
          sessionId: "session-1",
          externalSessionId: "external-1",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "build",
          scenario: "build_implementation_start",
          status: "running",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeKind: "opencode",
          runtimeId: "runtime-1",
          runId: null,
          runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4555" },
          workingDirectory: "/tmp/repo/resolved-worktree",
          messages: [],
          draftAssistantText: "",
          draftAssistantMessageId: null,
          draftReasoningText: "",
          draftReasoningMessageId: null,
          contextUsage: null,
          pendingPermissions: [],
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
    let observedSnapshotDirectories: string[] = [];

    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };

    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        loadSessionHistory: async () => [],
        listLiveAgentSessionSnapshots: async ({ directories }) => {
          observedSnapshotDirectories = directories ?? [];
          return [
            {
              externalSessionId: "external-1",
              title: "BUILD task-1",
              workingDirectory: "/tmp/repo/resolved-worktree",
              startedAt: "2026-02-22T08:00:00.000Z",
              status: { type: "busy" },
              pendingPermissions: [],
              pendingQuestions: [],
            },
          ];
        },
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      loadRepoPromptOverrides: async () => ({}),
    });

    await loadAgentSessions("task-1", {
      mode: "requested_history",
      targetSessionId: "session-1",
      historyPolicy: "requested_only",
      persistedRecords: [
        persistedSessionRecord({
          runtimeKind: "opencode",
          sessionId: "session-1",
          externalSessionId: "external-1",
          taskId: "task-1",
          role: "build",
          scenario: "build_implementation_start",
          status: "running",
          startedAt: "2026-02-22T08:00:00.000Z",
          updatedAt: "2026-02-22T08:00:00.000Z",
          workingDirectory: "/tmp/repo/stale-worktree",
        }),
      ],
    });

    expect(observedSnapshotDirectories).toEqual(["/tmp/repo/resolved-worktree"]);
    expect(state["session-1"]?.workingDirectory).toBe("/tmp/repo/resolved-worktree");
  });

  test("preserves canonical live messages that arrive during requested-history hydration", async () => {
    const historyDeferred =
      createDeferred<Awaited<ReturnType<ReturnType<typeof createAdapter>["loadSessionHistory"]>>>();
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-live": {
          sessionId: "session-live",
          externalSessionId: "external-live",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "build",
          scenario: "build_implementation_start",
          status: "running",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeKind: "opencode",
          runtimeId: "runtime-live",
          runId: null,
          runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
          workingDirectory: "/tmp/repo/worktree",
          messages: [],
          draftAssistantText: "",
          draftAssistantMessageId: null,
          draftReasoningText: "",
          draftReasoningMessageId: null,
          contextUsage: null,
          pendingPermissions: [],
          pendingQuestions: [],
          todos: [],
          modelCatalog: null,
          selectedModel: null,
          isLoadingModelCatalog: false,
          promptOverrides: {},
        },
      },
    };

    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      sessionsRef.current = typeof updater === "function" ? updater(sessionsRef.current) : updater;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        loadSessionHistory: async () => historyDeferred.promise,
        listLiveAgentSessionSnapshots: async () => [
          {
            externalSessionId: "external-live",
            title: "BUILD task-1",
            workingDirectory: "/tmp/repo/worktree",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
            pendingPermissions: [],
            pendingQuestions: [],
          },
        ],
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current = {
          ...sessionsRef.current,
          [sessionId]: updater(current),
        };
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    const loadPromise = loadAgentSessions("task-1", {
      mode: "requested_history",
      targetSessionId: "session-live",
      historyPolicy: "requested_only",
      persistedRecords: [
        persistedSessionRecord({
          runtimeKind: "opencode",
          sessionId: "session-live",
          externalSessionId: "external-live",
          taskId: "task-1",
          role: "build",
          scenario: "build_implementation_start",
          status: "running",
          startedAt: "2026-02-22T08:00:00.000Z",
          updatedAt: "2026-02-22T08:00:00.000Z",
          workingDirectory: "/tmp/repo/worktree",
          pendingPermissions: [],
          pendingQuestions: [],
        }),
      ],
    });

    await Promise.resolve();
    const currentSession = sessionsRef.current["session-live"];
    if (!currentSession) {
      throw new Error("Expected in-memory session before resolving hydration");
    }
    sessionsRef.current["session-live"] = {
      ...currentSession,
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Live replacement",
          timestamp: "2026-02-22T08:00:02.000Z",
          meta: { kind: "assistant", agentRole: "build", isFinal: true },
        },
        {
          id: "live-user-1",
          role: "user",
          content: "Live user message",
          timestamp: "2026-02-22T08:00:03.000Z",
        },
      ],
    };

    historyDeferred.resolve([
      {
        messageId: "assistant-1",
        parts: [
          {
            kind: "text",
            messageId: "assistant-1",
            partId: "assistant-part-1",
            text: "Hydrated assistant message",
            completed: true,
          },
        ],
        role: "assistant",
        timestamp: "2026-02-22T08:00:01.000Z",
        text: "Hydrated assistant message",
      },
    ]);

    await loadPromise;

    const mergedMessages = sessionMessagesToArray(getSession(sessionsRef.current, "session-live"));
    expect(mergedMessages.some((message) => message.id === "live-user-1")).toBe(true);
    expect(mergedMessages.find((message) => message.id === "assistant-1")?.content).toBe(
      "Live replacement",
    );
  });

  test("does not eagerly hydrate session history or runtime connections without an explicit target session", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let historyLoads = 0;
    let runLoads = 0;
    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };
    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        loadSessionHistory: async () => {
          historyLoads += 1;
          return [];
        },
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      loadRepoPromptOverrides: async () => ({}),
    });

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRunsList = legacyHost.runsList;
    hostModule.host.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      }),
    ];
    legacyHost.runsList = async () => {
      runLoads += 1;
      return [];
    };

    try {
      await loadAgentSessions("task-1");
    } finally {
      hostModule.host.agentSessionsList = originalList;
      legacyHost.runsList = originalRunsList;
    }

    expect(Object.keys(state)).toContain("session-1");
    expect(historyLoads).toBe(0);
    expect(runLoads).toBe(0);
    expect(state["session-1"] ? sessionMessagesToArray(state["session-1"]) : undefined).toEqual([]);
    expect(state["session-1"]?.runtimeRoute).toBeNull();
  });

  test("hydrates requested session through its persisted runtime kind when endpoint is missing", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let observedRuntimeEndpoint = "";
    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };

    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        loadSessionHistory: async ({ runtimeConnection }) => {
          observedRuntimeEndpoint =
            runtimeConnection.type === "local_http" ? runtimeConnection.endpoint : "";
          return [];
        },
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      loadRepoPromptOverrides: async () => ({}),
    });

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRuntimeList = hostModule.host.runtimeList;
    const originalEnsure = hostModule.host.runtimeEnsure;
    const ensuredRuntimeKinds: string[] = [];
    hostModule.host.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "claude-code",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
        scenario: "planner_initial",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
        selectedModel: {
          runtimeKind: "claude-code",
          providerId: "anthropic",
          modelId: "claude-3-7-sonnet",
        },
      }),
    ];
    hostModule.host.runtimeList = async (_repoPath, runtimeKind = "opencode") => [
      {
        kind: runtimeKind,
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http",
          endpoint: "http://127.0.0.1:4555",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: {
          ...OPENCODE_RUNTIME_DESCRIPTOR,
          kind: runtimeKind,
          label: "Claude Code",
          description: "Claude Code runtime",
        },
      },
    ];
    hostModule.host.runtimeEnsure = async (_repoPath, runtimeKind) => {
      ensuredRuntimeKinds.push(runtimeKind);
      return {
        kind: runtimeKind,
        runtimeId: "runtime-claude",
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
          label: "Claude Code",
          description: "Claude Code runtime",
        },
      };
    };

    try {
      await loadAgentSessions("task-1", {
        mode: "requested_history",
        targetSessionId: "session-1",
        historyPolicy: "requested_only",
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      hostModule.host.runtimeEnsure = originalEnsure;
    }

    expect(ensuredRuntimeKinds).toEqual([]);
    expect(observedRuntimeEndpoint).toBe("http://127.0.0.1:4555");
    expect(state["session-1"]?.runtimeKind).toBe("claude-code");
    expect(state["session-1"]?.runtimeId).toBe("runtime-1");
  });

  test("rejects requested-session warmup when persisted runtime metadata is missing", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": {
          sessionId: "session-1",
          externalSessionId: "external-1",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "planner",
          scenario: "planner_initial",
          status: "idle",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeId: null,
          runId: null,
          runtimeRoute: null,
          workingDirectory: "/tmp/repo",
          messages: [
            {
              id: "history:session-start:session-1",
              role: "system",
              content: "Session started (planner - planner_initial)",
              timestamp: "2026-02-22T08:00:00.000Z",
            },
          ],
          draftAssistantText: "",
          draftAssistantMessageId: null,
          draftReasoningText: "",
          draftReasoningMessageId: null,
          pendingPermissions: [],
          pendingQuestions: [],
          todos: [],
          modelCatalog: null,
          selectedModel: null,
          isLoadingModelCatalog: false,
        },
      },
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter(),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById: () => {},
      taskRef: { current: [taskFixture] },
      updateSession: () => {},
      loadRepoPromptOverrides: async () => ({}),
    });

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    hostModule.host.agentSessionsList = async () => [
      {
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        repoPath: "/tmp/repo",
        role: "planner",
        scenario: "planner_initial",
        status: "idle",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      } as unknown as AgentSessionRecord,
    ];

    try {
      await expect(
        loadAgentSessions("task-1", {
          mode: "requested_history",
          targetSessionId: "session-1",
          historyPolicy: "requested_only",
        }),
      ).rejects.toThrow("Persisted session 'session-1' is missing runtime kind metadata.");
    } finally {
      hostModule.host.agentSessionsList = originalList;
    }
  });

  test("warms requested-session todos even when the model catalog is already loaded", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": {
          runtimeKind: "opencode",
          sessionId: "session-1",
          externalSessionId: "external-1",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "planner",
          scenario: "planner_initial",
          status: "idle",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeId: "runtime-1",
          runId: null,
          runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4555" },
          workingDirectory: "/tmp/repo",
          messages: [
            {
              id: "history:session-start:session-1",
              role: "system",
              content: "Session started (planner - planner_initial)",
              timestamp: "2026-02-22T08:00:00.000Z",
            },
          ],
          draftAssistantText: "",
          draftAssistantMessageId: null,
          draftReasoningText: "",
          draftReasoningMessageId: null,
          pendingPermissions: [],
          pendingQuestions: [],
          todos: [],
          modelCatalog: {
            models: [],
            defaultModelsByProvider: {},
          },
          selectedModel: null,
          isLoadingModelCatalog: false,
        },
      },
    };
    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter(),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById: () => {},
      taskRef: { current: [taskFixture] },
      updateSession: () => {},
      loadRepoPromptOverrides: async () => ({}),
    });

    const hostModule = await import("../../shared/host");
    const typedHost = hostModule.host as Omit<typeof hostModule.host, "runtimeList"> & {
      runtimeList: () => Promise<RuntimeInstanceSummary[]>;
    };
    const originalList = typedHost.agentSessionsList;
    const originalRuntimeList = typedHost.runtimeList;
    typedHost.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
        scenario: "planner_initial",
        status: "idle",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      }),
    ];
    hostModule.host.runtimeList = (async (): Promise<RuntimeInstanceSummary[]> => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4444",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ]) as typeof hostModule.host.runtimeList;

    try {
      await loadAgentSessions("task-1", {
        mode: "requested_history",
        targetSessionId: "session-1",
        historyPolicy: "requested_only",
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
    }
    expect(sessionsRef.current["session-1"]?.runtimeRoute).toEqual({
      type: "local_http",
      endpoint: "http://127.0.0.1:4555",
    });
  });

  test("rehydrates persisted sessions that exist in memory with empty message history", async () => {
    const existingSession: AgentSessionState = {
      runtimeKind: "opencode",
      sessionId: "session-1",
      externalSessionId: "external-1",
      taskId: "task-1",
      repoPath: "/tmp/repo",
      role: "build",
      scenario: "build_implementation_start",
      status: "stopped",
      startedAt: "2026-02-22T08:00:00.000Z",
      runtimeId: "runtime-1",
      runId: "run-1",
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
      workingDirectory: "/tmp/repo",
      messages: [],
      draftAssistantText: "",
      draftAssistantMessageId: null,
      draftReasoningText: "",
      draftReasoningMessageId: null,
      pendingPermissions: [],
      pendingQuestions: [],
      todos: [],
      modelCatalog: null,
      selectedModel: null,
      isLoadingModelCatalog: true,
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: { "session-1": existingSession },
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
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      const next = updater(current);
      state = {
        ...state,
        [sessionId]: next,
      };
      sessionsRef.current = state;
    };

    let historyLoads = 0;
    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        loadSessionHistory: async () => {
          historyLoads += 1;
          return [];
        },
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      loadRepoPromptOverrides: async () => ({}),
    });

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRuntimeList = hostModule.host.runtimeList;
    const originalRunsList = legacyHost.runsList;
    hostModule.host.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo/worktree",
      }),
    ];
    hostModule.host.runtimeList = async () => [];
    legacyHost.runsList = async () => [
      {
        runId: "run-1",
        runtimeKind: "opencode",
        runtimeRoute: {
          type: "local_http",
          endpoint: "http://127.0.0.1:4444",
        },
        repoPath: "/tmp/repo",
        taskId: "task-1",
        branch: "obp/task-1",
        worktreePath: "/tmp/repo/worktree",
        port: 4444,
        state: "running",
        lastMessage: null,
        startedAt: "2026-02-22T08:00:00.000Z",
      },
    ];

    try {
      await loadAgentSessions("task-1", {
        mode: "requested_history",
        targetSessionId: "session-1",
        historyPolicy: "requested_only",
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      legacyHost.runsList = originalRunsList;
    }

    expect(historyLoads).toBe(1);
    expect(sessionMessagesToArray(getSession(state, "session-1")).length).toBeGreaterThan(0);
    expect(sessionMessageAt(getSession(state, "session-1"), 0)?.id).toBe(
      "history:session-start:session-1",
    );
  });

  test("hydrates runtime pending permissions and questions for a requested live session", async () => {
    const setSessionsByIdCalls: Array<Record<string, AgentSessionState>> = [];
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": {
          sessionId: "session-1",
          externalSessionId: "external-session-1",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "build" as const,
          scenario: "build_implementation_start" as const,
          status: "running" as const,
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeId: null,
          runId: null,
          runtimeRoute: null,
          runtimeKind: "opencode" as const,
          workingDirectory: "/tmp/repo/worktree",
          messages: [],
          draftAssistantText: "",
          draftAssistantMessageId: null,
          draftReasoningText: "",
          draftReasoningMessageId: null,
          pendingPermissions: [],
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
      listLiveAgentSessionSnapshots: async () => [
        {
          externalSessionId: "external-session-1",
          title: "BUILD task-1",
          workingDirectory: "/tmp/repo/worktree",
          startedAt: "2026-02-22T08:00:00.000Z",
          status: { type: "busy" },
          pendingPermissions: [
            {
              requestId: "perm-1",
              permission: "read",
              patterns: ["**/.env"],
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
      taskRef: { current: [taskFixture] },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current = {
          ...sessionsRef.current,
          [sessionId]: updater(current),
        };
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    const record = persistedSessionRecord({
      runtimeKind: "opencode",
      sessionId: "session-1",
      externalSessionId: "external-session-1",
      taskId: "task-1",
      role: "build",
      scenario: "build_implementation_start",
      status: "stopped",
      startedAt: "2026-02-22T08:00:00.000Z",
      updatedAt: "2026-02-22T08:00:00.000Z",
      workingDirectory: "/tmp/repo/worktree",
      pendingPermissions: [],
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
      targetSessionId: "session-1",
      persistedRecords: [record],
      preloadedRuntimeLists: new Map([["opencode", hostRuntimeList]]),
    });

    expect(setSessionsByIdCalls.length).toBeGreaterThan(0);
    expect(sessionsRef.current["session-1"]?.pendingPermissions).toEqual([
      { requestId: "perm-1", permission: "read", patterns: ["**/.env"] },
    ]);
    expect(sessionsRef.current["session-1"]?.pendingQuestions).toEqual([
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
      taskRef: { current: [taskFixture] },
      updateSession: () => {},
      loadRepoPromptOverrides: async () => ({}),
    });

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    hostModule.host.agentSessionsList = async () => [
      {
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        repoPath: "/tmp/repo",
        role: "build",
        scenario: "build_implementation_start",
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
          targetSessionId: "session-1",
          historyPolicy: "requested_only",
        }),
      ).rejects.toThrow("Persisted session 'session-1' is missing runtime kind metadata.");
      expect(state["session-1"]?.messages ?? []).toEqual([]);
    } finally {
      hostModule.host.agentSessionsList = originalList;
    }
  });

  test("rehydrates qa sessions through the shared workspace runtime when no persisted build session exists", async () => {
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
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      const next = updater(current);
      observedRuntimeEndpoint =
        next.runtimeRoute?.type === "local_http" ? next.runtimeRoute.endpoint : null;
      state = {
        ...state,
        [sessionId]: next,
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
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
      taskRef: { current: [taskFixture] },
      updateSession,
      loadRepoPromptOverrides: async () => ({}),
    });

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRuntimeList = hostModule.host.runtimeList;
    hostModule.host.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        sessionId: "session-qa-1",
        externalSessionId: "external-qa-1",
        taskId: "task-1",
        role: "qa",
        scenario: "qa_review",
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
        targetSessionId: "session-qa-1",
        historyPolicy: "requested_only",
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
    }

    if (observedRuntimeEndpoint === null) {
      throw new Error("Expected QA hydration to resolve a live runtime endpoint");
    }
    expect(String(observedRuntimeEndpoint)).toBe("http://127.0.0.1:4444");
    expect(state["session-qa-1"]?.runtimeId).toBe("runtime-1");
    expect(sessionMessageAt(getSession(state, "session-qa-1"), 0)?.id).toBe(
      "history:session-start:session-qa-1",
    );
  });

  test("does not ensure a workspace runtime for qa sessions when repo root paths only differ by trailing slash", async () => {
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
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
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
      taskRef: { current: [taskFixture] },
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
        sessionId: "session-qa-root",
        externalSessionId: "external-qa-root",
        taskId: "task-1",
        role: "qa",
        scenario: "qa_review",
        status: "stopped",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo/",
      }),
    ];
    hostModule.host.runtimeList = async () => [];
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
      await expect(
        loadAgentSessions("task-1", {
          mode: "requested_history",
          targetSessionId: "session-qa-root",
          historyPolicy: "requested_only",
        }),
      ).rejects.toThrow("No live runtime found for working directory /tmp/repo/.");
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      legacyHost.runsList = originalRunsList;
      hostModule.host.runtimeEnsure = originalEnsure;
    }

    expect(ensuredRuntimeKinds).toEqual([]);
    expect(
      state["session-qa-root"] ? sessionMessagesToArray(state["session-qa-root"]) : undefined,
    ).toEqual([]);
  });

  test("invalidates runtime list cache after ensuring a workspace runtime during hydration", async () => {
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
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
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
      taskRef: { current: [taskFixture] },
      updateSession,
      loadRepoPromptOverrides: async () => ({}),
    });

    const queryKey = runtimeQueryKeys.list("opencode", "/tmp/repo");
    appQueryClient.setQueryData(queryKey, []);

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRuntimeList = hostModule.host.runtimeList;
    const originalRunsList = legacyHost.runsList;
    const originalEnsure = hostModule.host.runtimeEnsure;
    hostModule.host.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
        scenario: "planner_initial",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      }),
    ];
    hostModule.host.runtimeList = async () => [];
    legacyHost.runsList = async () => [];
    hostModule.host.runtimeEnsure = async (_repoPath, runtimeKind) => ({
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
    });

    try {
      await loadAgentSessions("task-1", {
        mode: "requested_history",
        targetSessionId: "session-1",
        historyPolicy: "requested_only",
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      legacyHost.runsList = originalRunsList;
      hostModule.host.runtimeEnsure = originalEnsure;
    }

    expect(appQueryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
  });

  test("fails fast instead of ensuring a workspace runtime for build sessions on worktree directories", async () => {
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
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      const next = updater(current);
      state = {
        ...state,
        [sessionId]: next,
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
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
      taskRef: { current: [taskFixture] },
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
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
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
        workingDirectory: "/tmp/repo/shared",
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
        workingDirectory: "/tmp/repo/shared",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4666",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      };
    };

    try {
      await expect(
        loadAgentSessions("task-1", {
          mode: "requested_history",
          targetSessionId: "session-1",
          historyPolicy: "requested_only",
        }),
      ).rejects.toThrow("No live runtime found for working directory /tmp/repo/conflict-worktree.");
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      legacyHost.runsList = originalRunsList;
      hostModule.host.runtimeEnsure = originalEnsure;
    }

    expect(ensuredRuntimeKinds).toEqual([]);
    expect(state["session-1"] ? sessionMessagesToArray(state["session-1"]) : undefined).toEqual([]);
  });

  test("fails fast instead of ensuring a workspace runtime for qa sessions on worktree directories", async () => {
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
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
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
      taskRef: { current: [taskFixture] },
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
        sessionId: "session-qa-worktree",
        externalSessionId: "external-qa-worktree",
        taskId: "task-1",
        role: "qa",
        scenario: "qa_review",
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
      await expect(
        loadAgentSessions("task-1", {
          mode: "requested_history",
          targetSessionId: "session-qa-worktree",
          historyPolicy: "requested_only",
        }),
      ).rejects.toThrow("No live runtime found for working directory /tmp/repo/worktrees/task-1.");
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      legacyHost.runsList = originalRunsList;
      hostModule.host.runtimeEnsure = originalEnsure;
    }

    expect(ensuredRuntimeKinds).toEqual([]);
    expect(
      state["session-qa-worktree"]
        ? sessionMessagesToArray(state["session-qa-worktree"])
        : undefined,
    ).toEqual([]);
  });

  test("resumes live persisted sessions without eagerly hydrating transcript history", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let resumeCalls = 0;
    let attachedListeners = 0;
    let historyLoads = 0;

    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };

    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        listLiveAgentSessionSnapshots: async () => [
          {
            externalSessionId: "external-1",
            title: "PLANNER task-1",
            workingDirectory: "/tmp/repo",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
            pendingPermissions: [],
            pendingQuestions: [],
          },
        ],
        loadSessionHistory: async () => {
          historyLoads += 1;
          return [
            {
              messageId: "history:session-start:session-1",
              parts: [
                {
                  kind: "text",
                  messageId: "history:session-start:session-1",
                  partId: "part-1",
                  text: "Resumed history",
                  completed: true,
                },
              ],
              role: "assistant",
              timestamp: "2026-02-22T08:00:01.000Z",
              text: "Resumed history",
            },
          ];
        },
        resumeSession: async (input) => {
          resumeCalls += 1;
          return {
            sessionId: input.sessionId,
            externalSessionId: input.externalSessionId,
            role: input.role,
            scenario: input.scenario,
            startedAt: "2026-02-22T08:00:00.000Z",
            status: "running",
            runtimeKind: input.runtimeKind,
          };
        },
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      attachSessionListener: () => {
        attachedListeners += 1;
      },
      loadRepoPromptOverrides: async () => ({}),
      loadTaskDocuments: async () => ({
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
    });

    const hostModule = await import("../../shared/host");
    const typedHost = hostModule.host as Omit<typeof hostModule.host, "runtimeList"> & {
      runtimeList: () => Promise<RuntimeInstanceSummary[]>;
    };
    const originalList = typedHost.agentSessionsList;
    const originalRuntimeList = typedHost.runtimeList;
    typedHost.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
        scenario: "planner_initial",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      }),
    ];
    hostModule.host.runtimeList = (async (): Promise<RuntimeInstanceSummary[]> => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4444",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ]) as typeof hostModule.host.runtimeList;

    try {
      await loadAgentSessions("task-1", { mode: "reconcile_live", historyPolicy: "none" });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
    }

    expect(resumeCalls).toBe(1);
    expect(historyLoads).toBe(0);
    expect(attachedListeners).toBe(1);
    expect(state["session-1"]?.status).toBe("running");
    expect(state["session-1"]?.runtimeRoute).toEqual({
      type: "local_http",
      endpoint: "http://127.0.0.1:4444",
    });
    expect(state["session-1"] ? sessionMessagesToArray(state["session-1"]) : undefined).toEqual([]);
  });

  test("does not attach projected live sessions when the repo changes while reconcile is in flight", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    const repoEpochRef = { current: 2 };
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    const resumeDeferred = createDeferred<void>();
    let attachedListeners = 0;

    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };

    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        listLiveAgentSessionSnapshots: async () => [
          {
            externalSessionId: "external-1",
            title: "PLANNER task-1",
            workingDirectory: "/tmp/repo",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
            pendingPermissions: [],
            pendingQuestions: [],
          },
        ],
        resumeSession: async (input) => {
          await resumeDeferred.promise;
          return {
            sessionId: input.sessionId,
            externalSessionId: input.externalSessionId,
            role: input.role,
            scenario: input.scenario,
            startedAt: "2026-02-22T08:00:00.000Z",
            status: "running",
            runtimeKind: input.runtimeKind,
          };
        },
      }),
      repoEpochRef,
      currentWorkspaceRepoPathRef,
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      attachSessionListener: () => {
        attachedListeners += 1;
      },
      loadRepoPromptOverrides: async () => ({}),
      loadTaskDocuments: async () => ({
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
    });

    const hostModule = await import("../../shared/host");
    const typedHost = hostModule.host as Omit<typeof hostModule.host, "runtimeList"> & {
      runtimeList: () => Promise<RuntimeInstanceSummary[]>;
    };
    const originalList = typedHost.agentSessionsList;
    const originalRuntimeList = typedHost.runtimeList;
    typedHost.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
        scenario: "planner_initial",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      }),
    ];
    hostModule.host.runtimeList = async (): Promise<RuntimeInstanceSummary[]> => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4444",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];

    try {
      const loadPromise = loadAgentSessions("task-1", {
        mode: "reconcile_live",
        historyPolicy: "live_if_empty",
      });
      repoEpochRef.current = 3;
      currentWorkspaceRepoPathRef.current = "/tmp/other-repo";
      resumeDeferred.resolve(undefined);
      await loadPromise;
    } finally {
      typedHost.agentSessionsList = originalList;
      typedHost.runtimeList = originalRuntimeList;
    }

    expect(attachedListeners).toBe(0);
    expect(state["session-1"]).toBeUndefined();
  });

  test("does not resume persisted sessions when the runtime does not report them live", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let resumeCalls = 0;

    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        listLiveAgentSessionSnapshots: async () => [],
        resumeSession: async (input) => {
          resumeCalls += 1;
          return {
            sessionId: input.sessionId,
            externalSessionId: input.externalSessionId,
            role: input.role,
            scenario: input.scenario,
            startedAt: "2026-02-22T08:00:00.000Z",
            status: "running",
            runtimeKind: input.runtimeKind,
          };
        },
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession: () => {},
      attachSessionListener: () => {},
      loadRepoPromptOverrides: async () => ({}),
      loadTaskDocuments: async () => ({
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
    });

    const hostModule = await import("../../shared/host");
    const typedHost = hostModule.host as Omit<typeof hostModule.host, "runtimeList"> & {
      runtimeList: () => Promise<RuntimeInstanceSummary[]>;
    };
    const originalList = typedHost.agentSessionsList;
    const originalRuntimeList = typedHost.runtimeList;
    typedHost.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
        scenario: "planner_initial",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      }),
    ];
    typedHost.runtimeList = async (): Promise<RuntimeInstanceSummary[]> => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4444",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];

    try {
      await loadAgentSessions("task-1", { mode: "reconcile_live", historyPolicy: "live_if_empty" });
    } finally {
      typedHost.agentSessionsList = originalList;
      typedHost.runtimeList = originalRuntimeList;
    }

    expect(resumeCalls).toBe(0);
    expect(state["session-1"]?.status).toBe("stopped");
  });

  test("reattaches already attached live sessions when reconciling after a repo switch", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let attachedListeners = 0;

    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };

    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        hasSession: () => true,
        listLiveAgentSessionSnapshots: async () => [
          {
            externalSessionId: "external-1",
            title: "PLANNER task-1",
            workingDirectory: "/tmp/repo",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
            pendingPermissions: [],
            pendingQuestions: [],
          },
        ],
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      attachSessionListener: () => {
        attachedListeners += 1;
      },
      loadRepoPromptOverrides: async () => ({}),
      loadTaskDocuments: async () => ({
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
    });

    const hostModule = await import("../../shared/host");
    const typedHost = hostModule.host as Omit<typeof hostModule.host, "runtimeList"> & {
      runtimeList: () => Promise<RuntimeInstanceSummary[]>;
    };
    const originalList = typedHost.agentSessionsList;
    const originalRuntimeList = typedHost.runtimeList;
    typedHost.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
        scenario: "planner_initial",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      }),
    ];
    typedHost.runtimeList = async (): Promise<RuntimeInstanceSummary[]> => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4444",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];

    try {
      await loadAgentSessions("task-1", { mode: "reconcile_live", historyPolicy: "live_if_empty" });
    } finally {
      typedHost.agentSessionsList = originalList;
      typedHost.runtimeList = originalRuntimeList;
    }

    expect(attachedListeners).toBe(1);
    expect(state["session-1"]?.status).toBe("running");
    expect(state["session-1"]?.runtimeRoute).toEqual({
      type: "local_http",
      endpoint: "http://127.0.0.1:4444",
    });
  });

  test("resumes and reattaches missing adapter sessions when reconciling after a repo switch", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let attachedListeners = 0;
    const resumeCalls: Array<{ sessionId: string; workingDirectory: string }> = [];

    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };

    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        hasSession: () => false,
        resumeSession: async (input) => {
          resumeCalls.push({
            sessionId: input.sessionId,
            workingDirectory: input.workingDirectory,
          });
          return {
            sessionId: input.sessionId,
            externalSessionId: input.externalSessionId,
            role: input.role,
            scenario: input.scenario,
            startedAt: "2026-02-22T08:00:00.000Z",
            status: "running",
            runtimeKind: input.runtimeKind,
          };
        },
        listLiveAgentSessionSnapshots: async () => [
          {
            externalSessionId: "external-1",
            title: "BUILDER task-1",
            workingDirectory: "/tmp/repo/worktree",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
            pendingPermissions: [],
            pendingQuestions: [],
          },
        ],
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      attachSessionListener: () => {
        attachedListeners += 1;
      },
      loadRepoPromptOverrides: async () => ({}),
      loadTaskDocuments: async () => ({
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
      liveAgentSessionStore: new LiveAgentSessionStore(),
    });

    const hostModule = await import("../../shared/host");
    const typedHost = hostModule.host as Omit<typeof hostModule.host, "runtimeList"> & {
      runtimeList: () => Promise<RuntimeInstanceSummary[]>;
    };
    const originalList = typedHost.agentSessionsList;
    const originalRuntimeList = typedHost.runtimeList;
    typedHost.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo/worktree",
      }),
    ];
    typedHost.runtimeList = async (): Promise<RuntimeInstanceSummary[]> => [
      {
        kind: "opencode",
        runtimeId: "runtime-worktree",
        repoPath: "/tmp/repo",
        taskId: "task-1",
        role: "build",
        workingDirectory: "/tmp/repo/worktree",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4555",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      } as unknown as RuntimeInstanceSummary,
    ];

    try {
      await loadAgentSessions("task-1", { mode: "reconcile_live", historyPolicy: "live_if_empty" });
    } finally {
      typedHost.agentSessionsList = originalList;
      typedHost.runtimeList = originalRuntimeList;
    }

    expect(resumeCalls).toEqual([
      {
        sessionId: "session-1",
        workingDirectory: "/tmp/repo/worktree",
      },
    ]);
    expect(attachedListeners).toBe(1);
    expect(state["session-1"]?.status).toBe("running");
    expect(state["session-1"]?.runtimeRoute).toEqual({
      type: "local_http",
      endpoint: "http://127.0.0.1:4555",
    });
  });

  test("does not reattach adapter-held sessions when the runtime no longer reports them live", async () => {
    const existingSession: AgentSessionState = {
      sessionId: "session-1",
      externalSessionId: "external-1",
      taskId: "task-1",
      repoPath: "/tmp/repo",
      role: "build",
      scenario: "build_implementation_start",
      status: "stopped",
      startedAt: "2026-02-22T08:00:00.000Z",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runId: null,
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4555" },
      workingDirectory: "/tmp/repo/worktree",
      messages: [],
      draftAssistantText: "",
      draftAssistantMessageId: null,
      draftReasoningText: "",
      draftReasoningMessageId: null,
      contextUsage: null,
      pendingPermissions: [{ requestId: "permission-1", permission: "read", patterns: [".env"] }],
      pendingQuestions: [
        {
          requestId: "question-1",
          questions: [
            {
              header: "Continue",
              question: "Proceed?",
              options: [],
              custom: true,
            },
          ],
        },
      ],
      todos: [],
      modelCatalog: null,
      selectedModel: null,
      isLoadingModelCatalog: false,
      promptOverrides: {},
    };
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: { "session-1": existingSession },
    };
    let state: Record<string, AgentSessionState> = sessionsRef.current;
    let attachedListeners = 0;

    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };

    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        hasSession: () => true,
        listLiveAgentSessionSnapshots: async () => [],
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      attachSessionListener: () => {
        attachedListeners += 1;
      },
      loadRepoPromptOverrides: async () => ({}),
      loadTaskDocuments: async () => ({
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
    });

    const hostModule = await import("../../shared/host");
    const typedHost = hostModule.host as typeof hostModule.host & {
      runtimeList: () => Promise<RuntimeInstanceSummary[]>;
    };
    const originalList = typedHost.agentSessionsList;
    const originalRuntimeList = typedHost.runtimeList;
    typedHost.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo/worktree",
      }),
    ];
    typedHost.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo/worktree",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4555",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];

    try {
      await loadAgentSessions("task-1", { mode: "reconcile_live", historyPolicy: "live_if_empty" });
    } finally {
      typedHost.agentSessionsList = originalList;
      typedHost.runtimeList = originalRuntimeList;
    }

    expect(attachedListeners).toBe(0);
    expect(state["session-1"]?.status).toBe("stopped");
    expect(state["session-1"]?.runtimeRoute).toEqual({
      type: "local_http",
      endpoint: "http://127.0.0.1:4555",
    });
    expect(state["session-1"]?.pendingPermissions).toEqual([]);
    expect(state["session-1"]?.pendingQuestions).toEqual([]);
  });

  test("skips hydration when repo epoch changes while loading persisted sessions", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    const repoEpochRef = { current: 2 };
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    const listDeferred = createDeferred<AgentSessionRecord[]>();
    let setCalls = 0;
    let state: Record<string, AgentSessionState> = {};
    let updateCalls = 0;
    let historyLoads = 0;

    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      setCalls += 1;
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        loadSessionHistory: async () => {
          historyLoads += 1;
          return [];
        },
      }),
      repoEpochRef,
      currentWorkspaceRepoPathRef,
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession: () => {
        updateCalls += 1;
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    const originalList = (await import("../../shared/host")).host.agentSessionsList;
    (await import("../../shared/host")).host.agentSessionsList = async () => listDeferred.promise;

    try {
      const loadPromise = loadAgentSessions("task-1");
      repoEpochRef.current = 3;
      currentWorkspaceRepoPathRef.current = "/tmp/other-repo";

      listDeferred.resolve([
        persistedSessionRecord({
          runtimeKind: "opencode",
          sessionId: "session-stale",
          externalSessionId: "external-stale",
          taskId: "task-1",
          role: "build",
          scenario: "build_implementation_start",
          status: "running",
          startedAt: "2026-02-22T08:00:00.000Z",
          updatedAt: "2026-02-22T08:00:00.000Z",
          workingDirectory: "/tmp/repo",
        }),
      ]);
      await loadPromise;
    } finally {
      (await import("../../shared/host")).host.agentSessionsList = originalList;
    }

    expect(setCalls).toBe(0);
    expect(Object.keys(state)).toHaveLength(0);
    expect(updateCalls).toBe(0);
    expect(historyLoads).toBe(0);
  });

  test("rehydrates system prompt without eager document host calls", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let specCalls = 0;
    let planCalls = 0;
    let qaCalls = 0;

    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };

    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      const next = updater(current);
      state = {
        ...state,
        [sessionId]: next,
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
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
      taskRef: { current: [taskFixture] },
      updateSession,
      loadRepoPromptOverrides: async () => ({}),
    });

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRuntimeList = hostModule.host.runtimeList;
    const originalRunsList = legacyHost.runsList;
    const originalEnsure = hostModule.host.runtimeEnsure;
    const originalSpecGet = hostModule.host.specGet;
    const originalPlanGet = hostModule.host.planGet;
    const originalQaGetReport = hostModule.host.qaGetReport;

    hostModule.host.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      }),
    ];
    hostModule.host.runtimeList = async () => [];
    legacyHost.runsList = async () => [];
    hostModule.host.runtimeEnsure = async () => {
      throw new Error("runtime unavailable");
    };
    hostModule.host.specGet = async () => {
      specCalls += 1;
      return { markdown: "spec", updatedAt: null };
    };
    hostModule.host.planGet = async () => {
      planCalls += 1;
      return { markdown: "plan", updatedAt: null };
    };
    hostModule.host.qaGetReport = async () => {
      qaCalls += 1;
      return { markdown: "qa", updatedAt: null };
    };

    try {
      await expect(
        loadAgentSessions("task-1", {
          mode: "requested_history",
          targetSessionId: "session-1",
          historyPolicy: "requested_only",
        }),
      ).rejects.toThrow("No live runtime found for working directory /tmp/repo.");
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      legacyHost.runsList = originalRunsList;
      hostModule.host.runtimeEnsure = originalEnsure;
      hostModule.host.specGet = originalSpecGet;
      hostModule.host.planGet = originalPlanGet;
      hostModule.host.qaGetReport = originalQaGetReport;
    }

    expect(state["session-1"] ? sessionMessagesToArray(state["session-1"]) : undefined).toEqual([]);
    expect(specCalls).toBe(0);
    expect(planCalls).toBe(0);
    expect(qaCalls).toBe(0);
  });

  test("deduplicates concurrent requested-history hydration for the same session", async () => {
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
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const historyDeferred =
      createDeferred<Awaited<ReturnType<ReturnType<typeof createAdapter>["loadSessionHistory"]>>>();
    let historyCalls = 0;
    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        loadSessionHistory: async () => {
          historyCalls += 1;
          return historyDeferred.promise;
        },
      }),
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      loadRepoPromptOverrides: async () => ({}),
    });

    const persistedRecords = [
      persistedSessionRecord({
        sessionId: "session-1",
        externalSessionId: "external-1",
        role: "build",
        scenario: "build_implementation_start",
        startedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      }),
    ];
    const preloadedRuntimeLists = new Map([
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
            runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
            startedAt: "2026-02-22T08:00:00.000Z",
            descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
          } satisfies RuntimeInstanceSummary,
        ],
      ],
    ]);

    const firstLoad = loadAgentSessions("task-1", {
      mode: "requested_history",
      targetSessionId: "session-1",
      historyPolicy: "requested_only",
      persistedRecords,
      preloadedRuntimeLists,
    });
    const secondLoad = loadAgentSessions("task-1", {
      mode: "requested_history",
      targetSessionId: "session-1",
      historyPolicy: "requested_only",
      persistedRecords,
      preloadedRuntimeLists,
    });

    while (historyCalls === 0) {
      await Promise.resolve();
    }
    expect(historyCalls).toBe(1);
    historyDeferred.resolve([
      {
        messageId: "history-user-1",
        role: "user",
        state: "read",
        timestamp: "2026-02-22T08:00:01.000Z",
        text: "Previous request",
        displayParts: [],
        parts: [],
      },
    ]);

    await Promise.all([firstLoad, secondLoad]);

    expect(historyCalls).toBe(1);
    expect(state["session-1"]?.historyHydrationState).toBe("hydrated");
    expect(
      someSessionMessageForTest(
        getSession(state, "session-1"),
        (message) => message.content === "Previous request",
      ),
    ).toBe(true);
  });

  test("keeps interactive and read-only requested-history hydration loads separate", async () => {
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
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const historyDeferred =
      createDeferred<Awaited<ReturnType<ReturnType<typeof createAdapter>["loadSessionHistory"]>>>();
    let historyCalls = 0;
    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        loadSessionHistory: async () => {
          historyCalls += 1;
          return historyDeferred.promise;
        },
      }),
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      loadRepoPromptOverrides: async () => ({}),
    });

    const persistedRecords = [
      persistedSessionRecord({
        sessionId: "session-1",
        externalSessionId: "external-1",
        role: "build",
        scenario: "build_implementation_start",
        startedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      }),
    ];
    const preloadedRuntimeLists = new Map([
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
            runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
            startedAt: "2026-02-22T08:00:00.000Z",
            descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
          } satisfies RuntimeInstanceSummary,
        ],
      ],
    ]);

    const interactiveLoad = loadAgentSessions("task-1", {
      mode: "requested_history",
      targetSessionId: "session-1",
      historyPolicy: "requested_only",
      persistedRecords,
      preloadedRuntimeLists,
    });
    const readonlyLoad = loadAgentSessions("task-1", {
      mode: "requested_history",
      targetSessionId: "session-1",
      historyPolicy: "requested_only",
      historyPreludeMode: "none",
      persistedRecords,
      preloadedRuntimeLists,
    });

    while (historyCalls < 2) {
      await Promise.resolve();
    }
    expect(historyCalls).toBe(2);

    historyDeferred.resolve([
      {
        messageId: "history-user-1",
        role: "user",
        state: "read",
        timestamp: "2026-02-22T08:00:01.000Z",
        text: "Previous request",
        displayParts: [],
        parts: [],
      },
    ]);

    await Promise.all([interactiveLoad, readonlyLoad]);
  });

  test("hydrates an already loaded requested session without reloading the full persisted session list", async () => {
    const existingSession: AgentSessionState = {
      sessionId: "session-1",
      externalSessionId: "external-1",
      taskId: "task-1",
      repoPath: "/tmp/repo",
      role: "build",
      scenario: "build_implementation_start",
      status: "idle",
      startedAt: "2026-02-22T08:00:00.000Z",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runId: null,
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
      workingDirectory: "/tmp/repo",
      historyHydrationState: "not_requested",
      messages: [
        {
          id: "hydrated-user-1",
          role: "user",
          content: "Hydrated message",
          timestamp: "2026-02-22T08:00:01.000Z",
          meta: {
            kind: "user",
            state: "queued",
            providerId: "openai",
            modelId: "gpt-5",
            profileId: "Hephaestus",
            variant: "high",
          },
        },
      ],
      draftAssistantText: "",
      draftAssistantMessageId: null,
      draftReasoningText: "",
      draftReasoningMessageId: null,
      contextUsage: null,
      pendingPermissions: [],
      pendingQuestions: [],
      todos: [],
      modelCatalog: null,
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
      },
      isLoadingModelCatalog: false,
      promptOverrides: {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: { "session-1": existingSession },
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
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    let persistedListCalls = 0;
    const originalList = (await import("../../shared/host")).host.agentSessionsList;
    (await import("../../shared/host")).host.agentSessionsList = async () => {
      persistedListCalls += 1;
      return [];
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        loadSessionHistory: async () => [
          {
            messageId: "hydrated-assistant-1",
            role: "assistant",
            timestamp: "2026-02-22T08:00:02.000Z",
            text: "Hydrated response",
            totalTokens: 123,
            model: {
              providerId: "openai",
              modelId: "gpt-5",
            },
            parts: [
              {
                kind: "step",
                messageId: "hydrated-assistant-1",
                partId: "hydrated-step-finish-1",
                phase: "finish",
                reason: "stop",
              },
            ],
          },
          {
            messageId: "hydrated-user-1",
            role: "user",
            state: "read",
            timestamp: "2026-02-22T08:00:01.000Z",
            text: "Hydrated message",
            displayParts: [],
            parts: [],
          },
        ],
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await loadAgentSessions("task-1", {
        mode: "requested_history",
        targetSessionId: "session-1",
        historyPolicy: "requested_only",
      });
    } finally {
      (await import("../../shared/host")).host.agentSessionsList = originalList;
    }

    expect(persistedListCalls).toBe(0);
    expect(state["session-1"]?.historyHydrationState).toBe("hydrated");
    expect(state["session-1"]?.contextUsage).toEqual({
      totalTokens: 123,
      providerId: "openai",
      modelId: "gpt-5",
    });
    expect(
      someSessionMessageForTest(
        getSession(state, "session-1"),
        (message) => message.content === "Hydrated message",
      ),
    ).toBe(true);
    const hydratedUser = findSessionMessageForTest(
      getSession(state, "session-1"),
      (message) => message.id === "hydrated-user-1",
    );
    if (!hydratedUser || hydratedUser.meta?.kind !== "user") {
      throw new Error("Expected hydrated user message metadata");
    }
    expect(hydratedUser.meta.state).toBe("read");
    expect(hydratedUser.meta.providerId).toBe("openai");
    expect(hydratedUser.meta.modelId).toBe("gpt-5");
    expect(hydratedUser.meta.profileId).toBe("Hephaestus");
    expect(hydratedUser.meta.variant).toBe("high");
  });
});
