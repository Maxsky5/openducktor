import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CODEX_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  type AgentSessionRecord,
  type AgentSessionState,
  type AttachSessionInput,
  createAdapter,
  createDeferred,
  createLoadAgentSessions,
  createTaskFixture,
  createTestQueryClient,
  getSession,
  type LegacyRunSummary,
  OPENCODE_RUNTIME_DESCRIPTOR,
  persistedSessionRecord,
  type RuntimeInstanceSummary,
  sessionMessageAt,
  sessionMessagesToArray,
  setupDefaultLoadSessionsHost,
} from "./load-sessions-test-harness";

let legacyHost!: { runsList: (repoPath?: string) => Promise<LegacyRunSummary[]> };

describe("agent-orchestrator requested history hydration", () => {
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

  test("reattaches requested-history live sessions so transcript views keep streaming", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    const attachedSessions: Array<{ repoPath: string; externalSessionId: string }> = [];
    const attachCalls: Array<{ externalSessionId: string }> = [];

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
        attachSession: async (input: AttachSessionInput) => {
          attachCalls.push({ externalSessionId: input.externalSessionId });
          return {
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-02-22T08:00:00.000Z",
            status: "running",
            runtimeKind: input.runtimeKind,
          };
        },
        listSessionPresence: async () => [
          {
            externalSessionId: "external-child-1",
            title: "Child live session",
            workingDirectory: "/tmp/repo/worktree",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
            pendingApprovals: [],
            pendingQuestions: [],
          },
        ],
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [createTaskFixture()] },
      updateSession,
      attachSessionListener: (repoPath, externalSessionId) => {
        attachedSessions.push({ repoPath, externalSessionId });
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    const preloadedRuntimeLists = new Map<"opencode", RuntimeInstanceSummary[]>([
      [
        "opencode",
        [
          {
            kind: "opencode",
            runtimeId: "runtime-worktree",
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

    await loadAgentSessions("task-1", {
      mode: "requested_history",
      targetExternalSessionId: "external-child-1",
      historyPolicy: "requested_only",
      allowLiveSessionResume: true,
      preloadedRuntimeLists,
      persistedRecords: [
        persistedSessionRecord({
          runtimeKind: "opencode",
          externalSessionId: "external-child-1",
          taskId: "task-1",
          role: "build",
          startedAt: "2026-02-22T08:00:00.000Z",
          workingDirectory: "/tmp/repo/worktree",
        }),
      ],
    });

    expect(attachedSessions).toEqual([
      {
        repoPath: "/tmp/repo",
        externalSessionId: "external-child-1",
      },
    ]);
    expect(attachCalls).toEqual([{ externalSessionId: "external-child-1" }]);
    expect(state["external-child-1"]?.status).toBe("running");
  });

  test("hydrates requested history without applying passive presence", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "external-codex-1": {
          externalSessionId: "external-codex-1",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "build",
          status: "running",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeKind: "codex",
          runtimeId: "runtime-codex",
          workingDirectory: "/tmp/repo",
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
          historyHydrationState: "not_requested",
          runtimeRecoveryState: "idle",
        },
      },
    };
    let state: Record<string, AgentSessionState> = sessionsRef.current;
    const attachCalls: string[] = [];

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
        loadSessionHistory: async () => [],
        attachSession: async (input: AttachSessionInput) => {
          attachCalls.push(input.externalSessionId);
          return {
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-02-22T08:00:00.000Z",
            status: "running",
            runtimeKind: input.runtimeKind,
          };
        },
        listSessionPresence: async () => {
          throw new Error("history hydration must not read top-level liveness");
        },
        readSessionPresence: async () => {
          throw new Error("history hydration must not read direct top-level liveness");
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

    const preloadedRuntimeLists = new Map<"codex", RuntimeInstanceSummary[]>([
      [
        "codex",
        [
          {
            kind: "codex",
            runtimeId: "runtime-codex",
            repoPath: "/tmp/repo",
            taskId: null,
            role: "workspace",
            workingDirectory: "/tmp/repo",
            runtimeRoute: {
              type: "local_http",
              endpoint: "http://127.0.0.1:1430",
            },
            startedAt: "2026-02-22T08:00:00.000Z",
            descriptor: CODEX_RUNTIME_DESCRIPTOR,
          },
        ],
      ],
    ]);

    await loadAgentSessions("task-1", {
      mode: "requested_history",
      targetExternalSessionId: "external-codex-1",
      historyPolicy: "requested_only",
      preloadedRuntimeLists,
      persistedRecords: [
        persistedSessionRecord({
          runtimeKind: "codex",
          externalSessionId: "external-codex-1",
          taskId: "task-1",
          role: "build",
          status: "running",
          startedAt: "2026-02-22T08:00:00.000Z",
          workingDirectory: "/tmp/repo",
        }),
      ],
    });

    expect(attachCalls).toEqual([]);
    expect(getSession(state, "external-codex-1").status).toBe("running");
    expect(getSession(state, "external-codex-1").historyHydrationState).toBe("hydrated");
  });

  test("does not run a presence-only refresh for already hydrated requested sessions", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "external-codex-1": {
          externalSessionId: "external-codex-1",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "build",
          status: "idle",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeKind: "codex",
          runtimeId: "runtime-codex",
          workingDirectory: "/tmp/repo",
          messages: [
            {
              id: "message-1",
              role: "assistant",
              content: "hydrated transcript",
              timestamp: "2026-02-22T08:00:03.000Z",
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
          historyHydrationState: "hydrated",
          runtimeRecoveryState: "idle",
        },
      },
    };
    let state: Record<string, AgentSessionState> = sessionsRef.current;
    let listPresenceCount = 0;

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
        loadSessionHistory: async () => {
          throw new Error("history should not be reloaded for an already hydrated session");
        },
        listSessionPresence: async () => {
          listPresenceCount += 1;
          throw new Error("already hydrated history must not read top-level liveness");
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

    const preloadedRuntimeLists = new Map<"codex", RuntimeInstanceSummary[]>([
      [
        "codex",
        [
          {
            kind: "codex",
            runtimeId: "runtime-codex",
            repoPath: "/tmp/repo",
            taskId: null,
            role: "workspace",
            workingDirectory: "/tmp/repo",
            runtimeRoute: {
              type: "local_http",
              endpoint: "http://127.0.0.1:1430",
            },
            startedAt: "2026-02-22T08:00:00.000Z",
            descriptor: CODEX_RUNTIME_DESCRIPTOR,
          },
        ],
      ],
    ]);

    await loadAgentSessions("task-1", {
      mode: "requested_history",
      targetExternalSessionId: "external-codex-1",
      historyPolicy: "none",
      preloadedRuntimeLists,
      persistedRecords: [
        persistedSessionRecord({
          runtimeKind: "codex",
          externalSessionId: "external-codex-1",
          taskId: "task-1",
          role: "build",
          status: "running",
          startedAt: "2026-02-22T08:00:00.000Z",
          workingDirectory: "/tmp/repo",
        }),
      ],
    });

    expect(listPresenceCount).toBe(0);
    expect(getSession(state, "external-codex-1").status).toBe("idle");
    expect(getSession(state, "external-codex-1").historyHydrationState).toBe("hydrated");
  });

  test("hydrates Codex history with per-turn model metadata instead of current selection", async () => {
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
      adapter: createAdapter({
        loadSessionHistory: async () => [
          {
            messageId: "turn-1-user",
            role: "user",
            state: "read",
            timestamp: "2026-02-22T08:00:00.000Z",
            text: "Use low reasoning",
            displayParts: [{ kind: "text", text: "Use low reasoning" }],
            model: {
              providerId: "codex",
              modelId: "gpt-5.3-codex",
              variant: "low",
            },
            parts: [],
          },
          {
            messageId: "turn-1-assistant",
            role: "assistant",
            timestamp: "2026-02-22T08:00:02.000Z",
            text: "Low response",
            totalTokens: 25,
            contextWindow: 128_000,
            model: {
              providerId: "codex",
              modelId: "gpt-5.3-codex",
              variant: "low",
            },
            parts: [
              {
                kind: "step",
                messageId: "turn-1-assistant",
                partId: "turn-1-finish",
                phase: "finish",
                reason: "stop",
              },
            ],
          },
          {
            messageId: "turn-2-user",
            role: "user",
            state: "read",
            timestamp: "2026-02-22T08:01:00.000Z",
            text: "Use high reasoning",
            displayParts: [{ kind: "text", text: "Use high reasoning" }],
            model: {
              providerId: "codex",
              modelId: "gpt-5.3-codex",
              variant: "high",
            },
            parts: [],
          },
          {
            messageId: "turn-2-assistant",
            role: "assistant",
            timestamp: "2026-02-22T08:01:03.000Z",
            text: "High response",
            totalTokens: 50,
            contextWindow: 128_000,
            model: {
              providerId: "codex",
              modelId: "gpt-5.3-codex",
              variant: "high",
            },
            parts: [
              {
                kind: "step",
                messageId: "turn-2-assistant",
                partId: "turn-2-finish",
                phase: "finish",
                reason: "stop",
              },
            ],
          },
        ],
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [createTaskFixture()] },
      updateSession,
      loadRepoPromptOverrides: async () => ({}),
    });
    const preloadedRuntimeLists = new Map<"codex", RuntimeInstanceSummary[]>([
      [
        "codex",
        [
          {
            kind: "codex",
            runtimeId: "runtime-codex",
            repoPath: "/tmp/repo",
            taskId: null,
            role: "workspace",
            workingDirectory: "/tmp/repo",
            runtimeRoute: {
              type: "local_http",
              endpoint: "http://127.0.0.1:1430",
            },
            startedAt: "2026-02-22T08:00:00.000Z",
            descriptor: CODEX_RUNTIME_DESCRIPTOR,
          },
        ],
      ],
    ]);

    await loadAgentSessions("task-1", {
      mode: "requested_history",
      targetExternalSessionId: "external-codex-1",
      historyPolicy: "requested_only",
      preloadedRuntimeLists,
      persistedRecords: [
        persistedSessionRecord({
          runtimeKind: "codex",
          externalSessionId: "external-codex-1",
          taskId: "task-1",
          role: "build",
          startedAt: "2026-02-22T08:00:00.000Z",
          workingDirectory: "/tmp/repo",
          selectedModel: {
            runtimeKind: "codex",
            providerId: "codex",
            modelId: "gpt-5.3-codex",
            variant: "medium",
          },
        }),
      ],
    });

    const session = getSession(state, "external-codex-1");
    const assistantMessages = sessionMessagesToArray(session).filter(
      (message) => message.role === "assistant",
    );

    expect(assistantMessages.map((message) => message.content)).toEqual([
      "Low response",
      "High response",
    ]);
    expect(assistantMessages.map((message) => message.meta?.kind)).toEqual([
      "assistant",
      "assistant",
    ]);
    expect(
      assistantMessages.map((message) =>
        message.meta?.kind === "assistant" ? message.meta.variant : undefined,
      ),
    ).toEqual(["low", "high"]);
    expect(session.contextUsage).toMatchObject({
      totalTokens: 50,
      providerId: "codex",
      modelId: "gpt-5.3-codex",
      variant: "high",
    });
  });

  test("uses the resolved working directory for requested-history state updates", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "external-1": {
          externalSessionId: "external-1",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "build",
          status: "running",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeKind: "opencode",
          runtimeId: "runtime-1",
          runId: null,
          workingDirectory: "/tmp/repo/resolved-worktree",
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
        loadSessionHistory: async () => [],
        listSessionPresence: async ({ directories }: { directories?: string[] }) => {
          observedSnapshotDirectories = directories ?? [];
          return [
            {
              externalSessionId: "external-1",
              title: "BUILD task-1",
              workingDirectory: "/tmp/repo/resolved-worktree",
              startedAt: "2026-02-22T08:00:00.000Z",
              status: { type: "busy" },
              pendingApprovals: [],
              pendingQuestions: [],
            },
          ];
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

    await loadAgentSessions("task-1", {
      mode: "requested_history",
      targetExternalSessionId: "external-1",
      historyPolicy: "requested_only",
      allowLiveSessionResume: true,
      persistedRecords: [
        persistedSessionRecord({
          runtimeKind: "opencode",
          externalSessionId: "external-1",
          taskId: "task-1",
          role: "build",
          status: "running",
          startedAt: "2026-02-22T08:00:00.000Z",
          updatedAt: "2026-02-22T08:00:00.000Z",
          workingDirectory: "/tmp/repo/stale-worktree",
        }),
      ],
    });

    expect(observedSnapshotDirectories).toEqual([]);
    expect(state["external-1"]?.workingDirectory).toBe("/tmp/repo/resolved-worktree");
  });

  test("preserves canonical live messages that arrive during requested-history hydration", async () => {
    const historyDeferred =
      createDeferred<Awaited<ReturnType<ReturnType<typeof createAdapter>["loadSessionHistory"]>>>();
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "external-live": {
          externalSessionId: "external-live",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "build",
          status: "running",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeKind: "opencode",
          runtimeId: "runtime-live",
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

    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      sessionsRef.current = typeof updater === "function" ? updater(sessionsRef.current) : updater;
    };

    const loadAgentSessions = createLoadAgentSessions({
      queryClient,
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        loadSessionHistory: async () => historyDeferred.promise,
        listSessionPresence: async () => [
          {
            externalSessionId: "external-live",
            title: "BUILD task-1",
            workingDirectory: "/tmp/repo/worktree",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
            pendingApprovals: [],
            pendingQuestions: [],
          },
        ],
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
        sessionsRef.current = {
          ...sessionsRef.current,
          [externalSessionId]: updater(current),
        };
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    const loadPromise = loadAgentSessions("task-1", {
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
    });

    await Promise.resolve();
    const currentSession = sessionsRef.current["external-live"];
    if (!currentSession) {
      throw new Error("Expected in-memory session before resolving hydration");
    }
    sessionsRef.current["external-live"] = {
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

    const mergedMessages = sessionMessagesToArray(getSession(sessionsRef.current, "external-live"));
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
      updateSession,
      loadRepoPromptOverrides: async () => ({}),
    });

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRunsList = legacyHost.runsList;
    hostModule.host.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
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

    expect(Object.keys(state)).toContain("external-1");
    expect(historyLoads).toBe(0);
    expect(runLoads).toBe(0);
    expect(state["external-1"] ? sessionMessagesToArray(state["external-1"]) : undefined).toEqual(
      [],
    );
    expect(state["external-1"]?.runtimeId).toBeNull();
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
        loadSessionHistory: async ({
          repoPath,
          runtimeKind,
          workingDirectory,
        }: {
          repoPath?: string;
          runtimeKind?: string;
          workingDirectory?: string;
        }) => {
          observedRuntimeEndpoint = `${repoPath}:${runtimeKind}:${workingDirectory}`;
          return [];
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
    const originalList = hostModule.host.agentSessionsList;
    const originalRuntimeList = hostModule.host.runtimeList;
    const originalEnsure = hostModule.host.runtimeEnsure;
    const ensuredRuntimeKinds: string[] = [];
    hostModule.host.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
        selectedModel: {
          runtimeKind: "opencode",
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
        targetExternalSessionId: "external-1",
        historyPolicy: "requested_only",
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      hostModule.host.runtimeEnsure = originalEnsure;
    }

    expect(ensuredRuntimeKinds).toEqual([]);
    expect(observedRuntimeEndpoint).toBe("/tmp/repo:opencode:/tmp/repo");
    expect(state["external-1"]?.runtimeKind).toBe("opencode");
    expect(state["external-1"]?.runtimeId).toBeNull();
  });

  test("rejects requested-session warmup when persisted runtime metadata is missing", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "external-1": {
          externalSessionId: "external-1",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "planner",
          status: "idle",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeId: null,
          runId: null,
          workingDirectory: "/tmp/repo",
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
      setSessionsById: () => {},
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
        role: "planner",
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
          targetExternalSessionId: "external-1",
          historyPolicy: "requested_only",
        }),
      ).rejects.toThrow("Persisted session 'external-1' is missing runtime kind metadata.");
    } finally {
      hostModule.host.agentSessionsList = originalList;
    }
  });

  test("warms requested-session todos even when the model catalog is already loaded", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "external-1": {
          runtimeKind: "opencode",
          externalSessionId: "external-1",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "planner",
          status: "idle",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeId: "runtime-1",
          runId: null,
          workingDirectory: "/tmp/repo",
          messages: [],
          draftAssistantText: "",
          draftAssistantMessageId: null,
          draftReasoningText: "",
          draftReasoningMessageId: null,
          pendingApprovals: [],
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
      setSessionsById: () => {},
      taskRef: { current: [createTaskFixture()] },
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
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
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
        targetExternalSessionId: "external-1",
        historyPolicy: "requested_only",
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
    }
    expect(sessionsRef.current["external-1"]?.runtimeId).toBe("runtime-1");
  });

  test("rehydrates persisted sessions that exist in memory with empty message history", async () => {
    const existingSession: AgentSessionState = {
      runtimeKind: "opencode",
      externalSessionId: "external-1",
      taskId: "task-1",
      repoPath: "/tmp/repo",
      role: "build",
      status: "stopped",
      startedAt: "2026-02-22T08:00:00.000Z",
      runtimeId: "runtime-1",
      runId: "run-1",
      workingDirectory: "/tmp/repo",
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
      isLoadingModelCatalog: true,
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
      const next = updater(current);
      state = {
        ...state,
        [externalSessionId]: next,
      };
      sessionsRef.current = state;
    };

    let historyLoads = 0;
    const loadAgentSessions = createLoadAgentSessions({
      queryClient,
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
      taskRef: { current: [createTaskFixture()] },
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
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
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
        targetExternalSessionId: "external-1",
        historyPolicy: "requested_only",
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      legacyHost.runsList = originalRunsList;
    }

    expect(historyLoads).toBe(1);
    expect(sessionMessagesToArray(getSession(state, "external-1")).length).toBeGreaterThan(0);
    expect(sessionMessageAt(getSession(state, "external-1"), 0)?.id).toBe(
      "history:system-prompt:external-1",
    );
  });
});
