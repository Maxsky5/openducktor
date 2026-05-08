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

describe("agent-orchestrator repo switch and requested hydration concurrency", () => {
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
        listSessionPresence: async () => [
          {
            externalSessionId: "external-1",
            title: "PLANNER task-1",
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
              messageId: "history:runtime-history:external-1",
              parts: [
                {
                  kind: "text",
                  messageId: "history:runtime-history:external-1",
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
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
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
    expect(state["external-1"]?.status).toBe("running");
    expect(state["external-1"] ? sessionMessagesToArray(state["external-1"]) : undefined).toEqual(
      [],
    );
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
        listSessionPresence: async () => [
          {
            externalSessionId: "external-1",
            title: "PLANNER task-1",
            workingDirectory: "/tmp/repo",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
            pendingApprovals: [],
            pendingQuestions: [],
          },
        ],
        resumeSession: async (input: ResumeSessionInput) => {
          await resumeDeferred.promise;
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
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
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
    expect(state["external-1"]).toBeUndefined();
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
      queryClient: appQueryClient,
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        listSessionPresence: async () => [],
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
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
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
    expect(state["external-1"]?.status).toBe("stopped");
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
        hasSession: () => true,
        listSessionPresence: async () => [
          {
            externalSessionId: "external-1",
            title: "PLANNER task-1",
            workingDirectory: "/tmp/repo",
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
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
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
    expect(state["external-1"]?.status).toBe("running");
  });

  test("resumes and reattaches missing adapter sessions when reconciling after a repo switch", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let attachedListeners = 0;
    const resumeCalls: Array<{ externalSessionId: string; workingDirectory: string }> = [];

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
        resumeSession: async (input: ResumeSessionInput) => {
          resumeCalls.push({
            externalSessionId: input.externalSessionId,
            workingDirectory: input.workingDirectory,
          });
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
            externalSessionId: "external-1",
            title: "BUILDER task-1",
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
      agentSessionPresenceStore: new AgentSessionPresenceStore(),
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
        role: "build",
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
        externalSessionId: "external-1",
        workingDirectory: "/tmp/repo/worktree",
      },
    ]);
    expect(attachedListeners).toBe(1);
    expect(state["external-1"]?.status).toBe("running");
    expect(state["external-1"]?.pendingApprovals).toEqual([]);
    expect(state["external-1"]?.pendingQuestions).toEqual([]);
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
          externalSessionId: "external-stale",
          taskId: "task-1",
          role: "build",
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
      queryClient: appQueryClient,
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
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
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
    legacyHost.runsList = async () => [];
    hostModule.host.runtimeEnsure = async (_repoPath, runtimeKind) => ({
      kind: runtimeKind,
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
    });
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
      hostModule.host.specGet = originalSpecGet;
      hostModule.host.planGet = originalPlanGet;
      hostModule.host.qaGetReport = originalQaGetReport;
    }

    expect(
      state["external-1"] ? sessionMessagesToArray(state["external-1"]) : undefined,
    ).toHaveLength(1);
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

    const historyDeferred =
      createDeferred<Awaited<ReturnType<ReturnType<typeof createAdapter>["loadSessionHistory"]>>>();
    let historyCalls = 0;
    const loadAgentSessions = createLoadAgentSessions({
      queryClient: appQueryClient,
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

    const workingDirectory = "/tmp/repo/worktree";
    const persistedRecords = [
      persistedSessionRecord({
        externalSessionId: "external-1",
        role: "build",
        startedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory,
      }),
    ];
    const preloadedRuntimeLists = new Map<RuntimeKind, RuntimeInstanceSummary[]>([
      [
        "opencode",
        [
          {
            kind: "opencode",
            runtimeId: "runtime-1",
            repoPath: "/tmp/repo",
            taskId: null,
            role: "workspace",
            workingDirectory,
            runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
            startedAt: "2026-02-22T08:00:00.000Z",
            descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
          } satisfies RuntimeInstanceSummary,
        ],
      ],
    ]);

    const firstLoad = loadAgentSessions("task-1", {
      mode: "requested_history",
      targetExternalSessionId: "external-1",
      historyPolicy: "requested_only",
      persistedRecords,
      preloadedRuntimeLists,
    });
    const secondLoad = loadAgentSessions("task-1", {
      mode: "requested_history",
      targetExternalSessionId: "external-1",
      historyPolicy: "requested_only",
      persistedRecords,
      preloadedRuntimeLists,
    });

    await waitForHistoryCallCount(() => historyCalls, 1);
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
    expect(state["external-1"]?.historyHydrationState).toBe("hydrated");
    expect(
      someSessionMessageForTest(
        getSession(state, "external-1"),
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

    const historyDeferred =
      createDeferred<Awaited<ReturnType<ReturnType<typeof createAdapter>["loadSessionHistory"]>>>();
    let historyCalls = 0;
    const loadAgentSessions = createLoadAgentSessions({
      queryClient: appQueryClient,
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

    const workingDirectory = "/tmp/repo/worktree";
    const persistedRecords = [
      persistedSessionRecord({
        externalSessionId: "external-1",
        role: "build",
        startedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory,
      }),
    ];
    const preloadedRuntimeLists = new Map<RuntimeKind, RuntimeInstanceSummary[]>([
      [
        "opencode",
        [
          {
            kind: "opencode",
            runtimeId: "runtime-1",
            repoPath: "/tmp/repo",
            taskId: null,
            role: "workspace",
            workingDirectory,
            runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
            startedAt: "2026-02-22T08:00:00.000Z",
            descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
          } satisfies RuntimeInstanceSummary,
        ],
      ],
    ]);

    const interactiveLoad = loadAgentSessions("task-1", {
      mode: "requested_history",
      targetExternalSessionId: "external-1",
      historyPolicy: "requested_only",
      persistedRecords,
      preloadedRuntimeLists,
    });
    const readonlyLoad = loadAgentSessions("task-1", {
      mode: "requested_history",
      targetExternalSessionId: "external-1",
      historyPolicy: "requested_only",
      historyPreludeMode: "none",
      persistedRecords,
      preloadedRuntimeLists,
    });

    await waitForHistoryCallCount(() => historyCalls, 2);
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
      externalSessionId: "external-1",
      taskId: "task-1",
      repoPath: "/tmp/repo",
      role: "build",
      status: "idle",
      startedAt: "2026-02-22T08:00:00.000Z",
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      runId: null,
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
      pendingApprovals: [],
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

    let persistedListCalls = 0;
    const originalList = (await import("../../shared/host")).host.agentSessionsList;
    (await import("../../shared/host")).host.agentSessionsList = async () => {
      persistedListCalls += 1;
      return [];
    };

    const loadAgentSessions = createLoadAgentSessions({
      queryClient: appQueryClient,
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
        targetExternalSessionId: "external-1",
        historyPolicy: "requested_only",
      });
    } finally {
      (await import("../../shared/host")).host.agentSessionsList = originalList;
    }

    expect(persistedListCalls).toBe(0);
    expect(state["external-1"]?.historyHydrationState).toBe("hydrated");
    expect(state["external-1"]?.contextUsage).toEqual({
      totalTokens: 123,
      providerId: "openai",
      modelId: "gpt-5",
    });
    expect(
      someSessionMessageForTest(
        getSession(state, "external-1"),
        (message) => message.content === "Hydrated message",
      ),
    ).toBe(true);
    const hydratedUser = findSessionMessageForTest(
      getSession(state, "external-1"),
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
