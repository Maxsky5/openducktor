import { beforeEach, describe, expect, test } from "bun:test";
import type {
  AgentSessionRecord,
  RuntimeInstanceSummary,
  RuntimeKind,
} from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  type AgentSessionPresenceSnapshot,
  toAgentSessionPresenceSnapshotFromLiveSnapshot,
} from "@openducktor/core";
import { appQueryClient, clearAppQueryClient } from "@/lib/query-client";
import { runtimeQueryKeys } from "@/state/queries/runtime";
import {
  findSessionMessageForTest,
  sessionMessageAt,
  sessionMessagesToArray,
  someSessionMessageForTest,
} from "@/test-utils/session-message-test-helpers";
import type { AgentSessionState as BaseAgentSessionState } from "@/types/agent-orchestrator";
import {
  createAgentSessionPresenceSnapshotFixture,
  createDeferred,
  createTaskCardFixture,
} from "../test-utils";
import { createLoadAgentSessions as createLoadAgentSessionsBase } from "./load-sessions";
import type { SessionLifecycleAdapter } from "./load-sessions-stages";
import { agentSessionPresenceLookupKey } from "./session-presence-cache";
import { AgentSessionPresenceStore } from "./session-presence-store";

type AgentSessionState = BaseAgentSessionState & { runId?: string | null };

const createLoadAgentSessions = createLoadAgentSessionsBase;

type LegacyRunSummary = { runId: string; worktreePath: string };

type LoadSessionHistoryInput = Parameters<
  NonNullable<SessionLifecycleAdapter["loadSessionHistory"]>
>[0];
type ResumeSessionInput = Parameters<NonNullable<SessionLifecycleAdapter["resumeSession"]>>[0];
type AttachSessionInput = Parameters<NonNullable<SessionLifecycleAdapter["attachSession"]>>[0];
type ListSessionPresenceInput = Parameters<
  NonNullable<SessionLifecycleAdapter["listSessionPresence"]>
>[0];
type ReadSessionPresenceInput = Parameters<
  NonNullable<SessionLifecycleAdapter["readSessionPresence"]>
>[0];
type AgentSessionPresenceSnapshotFromLiveSnapshotInput = Parameters<
  typeof toAgentSessionPresenceSnapshotFromLiveSnapshot
>[0];

type SessionLifecycleAdapterOverrides = Partial<
  Omit<SessionLifecycleAdapter, "listSessionPresence" | "readSessionPresence">
> & {
  listSessionPresence?: (input: ListSessionPresenceInput) => Promise<unknown[]>;
  readSessionPresence?: (input: ReadSessionPresenceInput) => Promise<unknown>;
};

let legacyHost!: { runsList: (repoPath?: string) => Promise<LegacyRunSummary[]> };

const taskFixture = createTaskCardFixture({ title: "Task" });

const createPresence = (
  externalSessionId: string,
  workingDirectory: string,
  overrides: Record<string, unknown> = {},
) =>
  createAgentSessionPresenceSnapshotFixture({
    ref: { externalSessionId, workingDirectory },
    snapshot: {
      externalSessionId,
      workingDirectory,
      ...overrides,
    },
  });

const getSession = (
  state: Record<string, AgentSessionState>,
  externalSessionId: string,
): AgentSessionState => {
  const session = state[externalSessionId];
  if (!session) {
    throw new Error(`Expected session ${externalSessionId}`);
  }
  return session;
};

const persistedSessionRecord = (
  input: {
    externalSessionId: string;
    role: AgentSessionRecord["role"];
    startedAt: string;
    workingDirectory: string;
    runtimeKind?: AgentSessionRecord["runtimeKind"];
    selectedModel?: AgentSessionRecord["selectedModel"];
  } & Record<string, unknown>,
): AgentSessionRecord => {
  const {
    runtimeKind,
    externalSessionId,
    role,
    startedAt,
    workingDirectory,
    selectedModel,
    ...rest
  } = input;

  return {
    runtimeKind: runtimeKind ?? "opencode",
    externalSessionId,
    role,
    startedAt,
    workingDirectory,
    selectedModel: selectedModel ?? null,
    ...rest,
  };
};

const createAdapter = (
  overrides: SessionLifecycleAdapterOverrides = {},
): SessionLifecycleAdapter => {
  const loadPresences = async (...args: [ListSessionPresenceInput]) => {
    const snapshots = (await overrides.listSessionPresence?.(...args)) ?? [];
    return snapshots.map((entry) => {
      if (entry && typeof entry === "object" && "ref" in entry) {
        return entry as AgentSessionPresenceSnapshot;
      }

      const snapshot = entry as AgentSessionPresenceSnapshotFromLiveSnapshotInput["snapshot"] & {
        externalSessionId: string;
        workingDirectory: string;
      };

      return toAgentSessionPresenceSnapshotFromLiveSnapshot({
        ref: {
          repoPath: "/tmp/repo",
          runtimeKind: "opencode",
          externalSessionId: snapshot.externalSessionId,
          workingDirectory: snapshot.workingDirectory,
        },
        runtimeId: "runtime-1",
        snapshot: snapshot as AgentSessionPresenceSnapshotFromLiveSnapshotInput["snapshot"],
      });
    });
  };

  const readSessionPresence = overrides.readSessionPresence
    ? async (input: ReadSessionPresenceInput) =>
        overrides.readSessionPresence?.(input) as Promise<AgentSessionPresenceSnapshot>
    : async (record: ReadSessionPresenceInput) => {
        const snapshots = await loadPresences({
          repoPath: record.repoPath ?? "/tmp/repo",
          runtimeKind: record.runtimeKind ?? "opencode",
          directories: [record.workingDirectory ?? "/tmp/repo/worktree"],
        });

        const match = snapshots.find(
          (snapshot) => snapshot.ref.externalSessionId === record.externalSessionId,
        );
        if (match) {
          return match;
        }

        return toAgentSessionPresenceSnapshotFromLiveSnapshot({
          ref: {
            repoPath: record.repoPath ?? "/tmp/repo",
            runtimeKind: record.runtimeKind ?? "opencode",
            externalSessionId: record.externalSessionId,
            workingDirectory: record.workingDirectory ?? "/tmp/repo/worktree",
          },
          runtimeId: null,
          snapshot: null,
        });
      };

  return {
    hasSession: () => false,
    loadSessionHistory: async () => [],
    resumeSession: async (input: ResumeSessionInput) => ({
      externalSessionId: input.externalSessionId,
      role: input.role,
      startedAt: "2026-02-22T08:00:00.000Z",
      status: "idle",
      runtimeKind: input.runtimeKind,
    }),
    attachSession: async (input: AttachSessionInput) => ({
      externalSessionId: input.externalSessionId,
      role: input.role,
      startedAt: "2026-02-22T08:00:00.000Z",
      status: "idle",
      runtimeKind: input.runtimeKind,
    }),
    ...overrides,
    listSessionPresence: loadPresences,
    readSessionPresence,
  };
};

const waitForHistoryCallCount = async (
  getHistoryCalls: () => number,
  expectedCalls: number,
): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (getHistoryCalls() >= expectedCalls) {
      return;
    }
    await Promise.resolve();
  }

  throw new Error(
    `Expected at least ${expectedCalls} history calls, received ${getHistoryCalls()}.`,
  );
};

describe("agent-orchestrator live reattach hydration", () => {
  beforeEach(async () => {
    await clearAppQueryClient();
    const hostModule = await import("../../shared/host");
    legacyHost = hostModule.host as typeof hostModule.host & {
      runsList: (repoPath?: string) => Promise<LegacyRunSummary[]>;
    };
    hostModule.host.runtimeList = async (repoPath = "/tmp/repo", runtimeKind = "opencode") => [
      {
        kind: runtimeKind,
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
      },
    ];
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

  test("hydrates transcript history after live reattach when reconcile uses live_if_empty", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let attachedToAdapter = false;
    let historyLoads = 0;
    let resumeCalls = 0;

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
      queryClient: appQueryClient,
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        hasSession: () => attachedToAdapter,
        listSessionPresence: async () => [
          {
            externalSessionId: "external-1",
            title: "PLANNER task-1",
            role: "planner",
            workingDirectory: "/tmp/repo",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
            pendingApprovals: [],
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
    expect(state["external-1"]?.historyHydrationState).toBe("hydrated");
    const reconciledContents = sessionMessagesToArray(getSession(state, "external-1")).map(
      (message) => message.content,
    );
    expect(reconciledContents[0]).toContain("System prompt:");
    expect(reconciledContents.slice(1)).toEqual(["Hydrated from reconcile"]);
  });

  test("still hydrates on first live_if_empty reattach when a live message lands before hydration gating", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let attachedToAdapter = false;
    let historyLoads = 0;
    let resumeCalls = 0;

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
      queryClient: appQueryClient,
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        hasSession: () => attachedToAdapter,
        listSessionPresence: async () => [
          {
            externalSessionId: "external-1",
            title: "PLANNER task-1",
            role: "planner",
            workingDirectory: "/tmp/repo",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
            pendingApprovals: [],
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
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      attachSessionListener: (_repoPath, externalSessionId) => {
        updateSession(externalSessionId, (current) => ({
          ...current,
          messages: [
            ...sessionMessagesToArray(current),
            {
              id: "live-message-1",
              role: "system",
              content: "Live message before hydration",
              timestamp: "2026-02-22T08:00:00.500Z",
            },
          ],
        }));
      },
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
    expect(state["external-1"]?.historyHydrationState).toBe("hydrated");
    const liveReconciledContents = sessionMessagesToArray(getSession(state, "external-1")).map(
      (message) => message.content,
    );
    expect(liveReconciledContents[0]).toContain("System prompt:");
    expect(liveReconciledContents.slice(1)).toEqual([
      "Hydrated from reconcile",
      "Live message before hydration",
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
      queryClient: appQueryClient,
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        hasSession: () => false,
        listSessionPresence: async () => [
          {
            externalSessionId: "external-1",
            title: "PLANNER task-1",
            role: "planner",
            workingDirectory: "/tmp/repo",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
            pendingApprovals: [],
            pendingQuestions: [],
          },
        ],
        resumeSession: async (input: ResumeSessionInput) => {
          resumeCalls += 1;
          return {
            externalSessionId: input.externalSessionId,
            role: input.role,
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
          externalSessionId: "external-1",
          taskId: "task-1",
          role: "planner",
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
      ]),
      historyPolicy: "none",
    });

    repoEpochRef.current = 3;
    currentWorkspaceRepoPathRef.current = "/tmp/other-repo";
    promptOverridesDeferred.resolve({});
    await loadPromise;

    expect(resumeCalls).toBe(0);
    expect(state["external-1"]?.runtimeId).toBeUndefined();
  });

  test("reuses the trusted live agent session store for requested session hydration", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "external-1": {
          externalSessionId: "external-1",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          runtimeKind: "opencode",
          role: "build",
          status: "idle",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeId: "runtime-1",
          runId: "run-1",
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
    let state = sessionsRef.current;
    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };

    const agentSessionPresenceStore = new AgentSessionPresenceStore();
    agentSessionPresenceStore.replaceRepoPresence(
      "/tmp/repo",
      new Map([
        [
          agentSessionPresenceLookupKey("/tmp/repo", "opencode", "/tmp/repo/worktree"),
          [
            createAgentSessionPresenceSnapshotFixture({
              ref: {
                repoPath: "/tmp/repo",
                runtimeKind: "opencode",
                externalSessionId: "external-1",
                workingDirectory: "/tmp/repo/worktree",
              },
              runtimeId: "runtime-1",
              snapshot: {
                title: "BUILD task-1",
                status: { type: "busy" },
                pendingApprovals: [],
                pendingQuestions: [],
              },
            }),
          ],
        ],
      ]) as Map<string, AgentSessionPresenceSnapshot[]>,
    );

    const loadAgentSessions = createLoadAgentSessions({
      queryClient: appQueryClient,
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        listSessionPresence: async () => {
          throw new Error("should not reload live snapshots");
        },
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession: (externalSessionId, updater) => {
        const currentSession = state[externalSessionId];
        if (!currentSession) {
          throw new Error(`Missing session '${externalSessionId}' in test state.`);
        }
        setSessionsById((current) => ({
          ...current,
          [externalSessionId]: updater(currentSession),
        }));
      },
      loadRepoPromptOverrides: async () => ({}),
      agentSessionPresenceStore,
    });

    await loadAgentSessions("task-1", {
      mode: "requested_history",
      targetExternalSessionId: "external-1",
      allowLiveSessionResume: true,
      persistedRecords: [
        persistedSessionRecord({
          runtimeKind: "opencode",
          externalSessionId: "external-1",
          taskId: "task-1",
          role: "build",
          startedAt: "2026-02-22T08:00:00.000Z",
          updatedAt: "2026-02-22T08:00:00.000Z",
          workingDirectory: "/tmp/repo/worktree",
        }),
      ],
    });

    expect(state["external-1"]?.status).toBe("running");
  });

  test("refreshes requested session history even when in-memory messages already exist", async () => {
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
    let historyLoads = 0;
    const loadAgentSessions = createLoadAgentSessions({
      queryClient: appQueryClient,
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
      setSessionsById: (updater) => {
        sessionsRef.current =
          typeof updater === "function" ? updater(sessionsRef.current) : updater;
      },
      taskRef: { current: [taskFixture] },
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
    });

    expect(historyLoads).toBe(1);
  });
});
