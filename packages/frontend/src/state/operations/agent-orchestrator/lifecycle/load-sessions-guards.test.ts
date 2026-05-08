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

describe("agent-orchestrator load-session guards and persisted records", () => {
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
      queryClient: appQueryClient,
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
      queryClient: appQueryClient,
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
      queryClient: appQueryClient,
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
        allowLiveSessionResume: true,
      });
    } finally {
      hostModule.host.agentSessionsList = originalList;
    }

    expect(state["external-1"]?.pendingApprovals).toEqual([]);
  });
});
