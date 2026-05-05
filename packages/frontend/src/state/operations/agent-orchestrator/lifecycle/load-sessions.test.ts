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
import { createLoadAgentSessions } from "./load-sessions";
import type { SessionLifecycleAdapter } from "./load-sessions-stages";
import { agentSessionPresenceLookupKey } from "./session-presence-cache";
import { AgentSessionPresenceStore } from "./session-presence-store";

type AgentSessionState = BaseAgentSessionState & { runId?: string | null };

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

describe("agent-orchestrator-load-sessions", () => {
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

    appQueryClient.setQueryData(runtimeQueryKeys.list("opencode", "/tmp/repo"), [
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
      taskRef: { current: [taskFixture] },
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
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
    }

    expect(state["external-1"]?.pendingApprovals).toEqual([]);
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
      taskRef: { current: [taskFixture] },
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
      taskRef: { current: [taskFixture] },
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
      preloadedLiveAgentSessionsByKey: new Map([
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
      taskRef: { current: [taskFixture] },
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
          ...persistedRecord,
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
      taskRef: { current: [taskFixture] },
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
          ...persistedRecord,
          externalSessionId: "external-1",
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
      taskRef: { current: [taskFixture] },
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
      taskRef: { current: [taskFixture] },
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
      taskRef: { current: [taskFixture] },
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

  test("uses the resolved working directory for requested-history live lookups and state updates", async () => {
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
      taskRef: { current: [taskFixture] },
      updateSession,
      loadRepoPromptOverrides: async () => ({}),
    });

    await loadAgentSessions("task-1", {
      mode: "requested_history",
      targetExternalSessionId: "external-1",
      historyPolicy: "requested_only",
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

    expect(observedSnapshotDirectories).toEqual(["/tmp/repo/resolved-worktree"]);
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

  test("fails fast when the runtime list cache has no live repo runtime during hydration", async () => {
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
      await expect(
        loadAgentSessions("task-1", {
          mode: "requested_history",
          targetExternalSessionId: "external-1",
          historyPolicy: "requested_only",
        }),
      ).rejects.toThrow("No live repo runtime found");
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      legacyHost.runsList = originalRunsList;
      hostModule.host.runtimeEnsure = originalEnsure;
    }

    expect(runtimeEnsureCalls).toEqual([]);
    expect(appQueryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
    expect(state["external-1"]?.historyHydrationState).toBe("failed");
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

  test("does not ensure a shared workspace runtime for qa sessions on non-root working directories", async () => {
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
      await expect(
        loadAgentSessions("task-1", {
          mode: "requested_history",
          targetExternalSessionId: "external-qa-worktree",
          historyPolicy: "requested_only",
        }),
      ).rejects.toThrow("No live repo runtime found");
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      legacyHost.runsList = originalRunsList;
      hostModule.host.runtimeEnsure = originalEnsure;
    }

    expect(ensuredRuntimeKinds).toEqual([]);
    expect(state["external-qa-worktree"]?.runtimeId).toBeNull();
    expect(state["external-qa-worktree"]?.historyHydrationState).toBe("failed");
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
