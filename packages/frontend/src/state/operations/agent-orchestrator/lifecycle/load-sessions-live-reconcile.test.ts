import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type AgentSessionState,
  type AttachSessionInput,
  createAdapter,
  createAgentSessionPresenceSnapshotFixture,
  createLoadAgentSessions,
  createTaskFixture,
  createTestQueryClient,
  getSession,
  type LegacyRunSummary,
  type ListSessionPresenceInput,
  OPENCODE_RUNTIME_DESCRIPTOR,
  persistedSessionRecord,
  type ResumeSessionInput,
  type RuntimeInstanceSummary,
  sessionMessagesToArray,
  setupDefaultLoadSessionsHost,
} from "./load-sessions-test-harness";

let _legacyHost!: { runsList: (repoPath?: string) => Promise<LegacyRunSummary[]> };

describe("agent-orchestrator live session reconciliation", () => {
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

  test("live reconciliation does not attach stale persisted sessions to the repo runtime", async () => {
    const persistedRecord = persistedSessionRecord({
      runtimeKind: "opencode",
      externalSessionId: "external-stale",
      taskId: "task-1",
      role: "build",
      startedAt: "2026-02-22T08:00:00.000Z",
      updatedAt: "2026-02-22T08:00:00.000Z",
      workingDirectory: "/tmp/repo/worktree",
    });
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "external-stale": {
          externalSessionId: persistedRecord.externalSessionId,
          role: persistedRecord.role,
          startedAt: persistedRecord.startedAt,
          workingDirectory: persistedRecord.workingDirectory,
          repoPath: "/tmp/repo",
          taskId: "task-1",
          status: "stopped",
          runtimeKind: "opencode",
          runtimeId: null,
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
    let liveSnapshotCalls = 0;
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
        listSessionPresence: async () => {
          liveSnapshotCalls += 1;
          return [];
        },
        loadSessionHistory: async () => {
          throw new Error("reconcile_live must not hydrate transcript history");
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
      attachSessionListener: () => {},
      loadRepoPromptOverrides: async () => ({}),
    });

    await loadAgentSessions("task-1", {
      mode: "reconcile_live",
      historyPolicy: "none",
      persistedRecords: [persistedRecord],
      preloadedRuntimeLists: new Map([
        [
          "opencode",
          [
            {
              kind: "opencode",
              runtimeId: "runtime-repo",
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
    });

    expect(liveSnapshotCalls).toBe(1);
    expect(getSession(state, "external-stale").runtimeId).toBeNull();
    expect(getSession(state, "external-stale").workingDirectory).toBe("/tmp/repo/worktree");
  });

  test("recovers a worktree session from a repo-root runtime after verifying the live external session", async () => {
    const persistedRecord = persistedSessionRecord({
      runtimeKind: "opencode",
      externalSessionId: "external-1",
      taskId: "task-1",
      role: "build",
      startedAt: "2026-02-22T08:00:00.000Z",
      updatedAt: "2026-02-22T08:00:00.000Z",
      workingDirectory: "/tmp/repo/worktree",
    });
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "external-1": {
          externalSessionId: persistedRecord.externalSessionId,
          role: persistedRecord.role,
          startedAt: persistedRecord.startedAt,
          workingDirectory: persistedRecord.workingDirectory,
          runtimeKind: "opencode",
          repoPath: "/tmp/repo",
          taskId: "task-1",
          status: "stopped",
          runtimeId: null,
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
    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };
    const observedSnapshotDirectories: string[][] = [];

    const loadAgentSessions = createLoadAgentSessions({
      queryClient,
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        listSessionPresence: async (input: ListSessionPresenceInput) => {
          observedSnapshotDirectories.push(input.directories ?? []);
          return [
            createAgentSessionPresenceSnapshotFixture({
              ref: { externalSessionId: "external-1", workingDirectory: "/tmp/repo/worktree" },
              runtimeId: "runtime-root",
              snapshot: {
                externalSessionId: "external-1",
                title: "BUILD task-1",
                workingDirectory: "/tmp/repo/worktree",
                startedAt: "2026-02-22T08:00:00.000Z",
                status: { type: "busy" },
                pendingApprovals: [],
                pendingQuestions: [],
              },
            }),
          ];
        },
        loadSessionHistory: async () => {
          throw new Error("recover_runtime_attachment must not hydrate transcript history");
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
      attachSessionListener: () => {},
      loadRepoPromptOverrides: async () => ({}),
    });

    await loadAgentSessions("task-1", {
      mode: "recover_runtime_attachment",
      targetExternalSessionId: "external-1",
      historyPolicy: "none",
      persistedRecords: [persistedRecord],
      preloadedRuntimeLists: new Map([
        [
          "opencode",
          [
            {
              kind: "opencode",
              runtimeId: "runtime-root",
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
    });

    expect(observedSnapshotDirectories).toEqual([["/tmp/repo/worktree"]]);
    expect(getSession(state, "external-1").runtimeId).toBe("runtime-root");
    expect(getSession(state, "external-1").workingDirectory).toBe("/tmp/repo/worktree");
    expect(getSession(state, "external-1").historyHydrationState).toBe("not_requested");
    expect(sessionMessagesToArray(getSession(state, "external-1"))).toEqual([]);
  });

  test("live reconciliation leaves unmatched records detached from the repo runtime", async () => {
    const firstRecord = persistedSessionRecord({
      runtimeKind: "opencode",
      externalSessionId: "external-1",
      taskId: "task-1",
      role: "build",
      startedAt: "2026-02-22T08:00:00.000Z",
      updatedAt: "2026-02-22T08:00:00.000Z",
      workingDirectory: "/tmp/repo/worktree",
    });
    const secondRecord = persistedSessionRecord({
      runtimeKind: "opencode",
      externalSessionId: "external-2",
      taskId: "task-1",
      role: "qa",
      startedAt: "2026-02-22T08:00:00.000Z",
      updatedAt: "2026-02-22T08:00:00.000Z",
      workingDirectory: "/tmp/repo/worktree",
    });
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
      adapter: createAdapter({
        listSessionPresence: async () => [
          createAgentSessionPresenceSnapshotFixture({
            ref: {
              repoPath: "/tmp/repo",
              runtimeKind: "opencode",
              externalSessionId: "external-1",
              workingDirectory: "/tmp/repo/worktree",
            },
            runtimeId: "runtime-root",
            snapshot: {
              title: "BUILD task-1",
              status: { type: "busy" },
              pendingApprovals: [],
              pendingQuestions: [],
            },
          }),
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
        state = {
          ...state,
          [externalSessionId]: updater(current),
        };
        sessionsRef.current = state;
      },
      attachSessionListener: () => {},
      loadRepoPromptOverrides: async () => ({}),
    });

    await loadAgentSessions("task-1", {
      mode: "reconcile_live",
      historyPolicy: "none",
      persistedRecords: [firstRecord, secondRecord],
      preloadedRuntimeLists: new Map([
        [
          "opencode",
          [
            {
              kind: "opencode",
              runtimeId: "runtime-root",
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
    });

    expect(getSession(state, "external-1").runtimeId).toBe("runtime-root");
    expect(getSession(state, "external-1").workingDirectory).toBe("/tmp/repo/worktree");
    expect(getSession(state, "external-2").runtimeId).toBeNull();
    expect(getSession(state, "external-2").workingDirectory).toBe("/tmp/repo/worktree");
    expect(sessionMessagesToArray(getSession(state, "external-1"))).toEqual([]);
    expect(sessionMessagesToArray(getSession(state, "external-2"))).toEqual([]);
  });

  test("composes bootstrap, requested history hydration, and live reconciliation without cross-mode regressions", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let attachedToAdapter = false;
    let sessionPresenceLoads = 0;
    let historyLoads = 0;
    let resumeCalls = 0;
    let attachCalls = 0;
    let attachedListeners = 0;
    let promptOverrideLoads = 0;

    const persistedRecords = [
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
        hasSession: () => attachedToAdapter,
        listSessionPresence: async () => {
          sessionPresenceLoads += 1;
          return [
            {
              externalSessionId: "external-1",
              title: "PLANNER task-1",
              role: "planner",
              workingDirectory: "/tmp/repo/worktree",
              startedAt: "2026-02-22T08:00:00.000Z",
              status: { type: "busy" },
              pendingApprovals: [
                {
                  requestId: "permission-live",
                  requestType: "permission_grant" as const,
                  title: `Approve permission: ${"read"}`,
                  summary: `Approval request for ${"read"}.`,
                  affectedPaths: ["README.md"],
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
        resumeSession: async (input: ResumeSessionInput) => {
          resumeCalls += 1;
          attachedToAdapter = true;
          return {
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-02-22T08:00:00.000Z",
            status: "running",
            runtimeKind: input.runtimeKind,
          };
        },
        attachSession: async (input: AttachSessionInput) => {
          attachCalls += 1;
          attachedToAdapter = true;
          return {
            externalSessionId: input.externalSessionId,
            role: input.role,
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
      taskRef: { current: [createTaskFixture()] },
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

    expect(state["external-1"]).toMatchObject({
      status: "stopped",
      messages: [],
      pendingApprovals: [],
      pendingQuestions: [],
    });
    expect(historyLoads).toBe(0);
    expect(resumeCalls).toBe(0);
    expect(attachCalls).toBe(0);
    expect(attachedListeners).toBe(0);
    expect(promptOverrideLoads).toBe(0);

    await loadAgentSessions("task-1", {
      mode: "requested_history",
      targetExternalSessionId: "external-1",
      persistedRecords,
      preloadedRuntimeLists: runtimeLists,
      historyPolicy: "requested_only",
      allowLiveSessionResume: true,
    });

    const hydratedSession = state["external-1"];
    expect(hydratedSession).toMatchObject({
      status: "idle",
      historyHydrationState: "hydrated",
      pendingApprovals: [
        {
          requestId: "permission-live",
          requestType: "permission_grant" as const,
          title: `Approve permission: ${"read"}`,
          summary: `Approval request for ${"read"}.`,
          affectedPaths: ["README.md"],
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
    expect(hydratedSession?.pendingQuestions).toHaveLength(1);
    const hydratedContents = hydratedSession
      ? sessionMessagesToArray(hydratedSession).map((message) => message.content)
      : [];
    expect(hydratedContents[0]).toContain("System prompt:");
    expect(hydratedContents.slice(1)).toEqual(["Requested history"]);
    expect(historyLoads).toBe(1);
    expect(resumeCalls).toBe(0);
    expect(attachCalls).toBe(1);
    expect(attachedListeners).toBe(1);

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
    expect(resumeCalls).toBe(0);
    expect(attachCalls).toBe(1);
    expect(attachedListeners).toBe(2);
    expect(sessionPresenceLoads).toBe(2);
    expect(
      sessionMessagesToArray(getSession(state, "external-1")).map((message) => message.id),
    ).toEqual(hydratedMessageIds);
    expect(state["external-1"]).toMatchObject({
      status: "idle",
      historyHydrationState: "hydrated",
      pendingApprovals: [
        {
          requestId: "permission-live",
          requestType: "permission_grant" as const,
          title: `Approve permission: ${"read"}`,
          summary: `Approval request for ${"read"}.`,
          affectedPaths: ["README.md"],
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
    expect(state["external-1"]?.pendingQuestions).toHaveLength(1);
    expect(promptOverrideLoads).toBe(1);
  });
});
